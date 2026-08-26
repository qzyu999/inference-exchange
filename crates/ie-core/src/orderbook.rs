use crate::types::*;
use chrono::Utc;
use parking_lot::RwLock;
use std::collections::{BTreeMap, HashMap, HashSet};
use thiserror::Error;
use tracing::debug;

#[derive(Debug, Error)]
pub enum MatchError {
    #[error("No capacity or providers available for model '{0}'")]
    NoCapacity(String),
    #[error("All providers exceeded maximum acceptable price ({max_acceptable_price} micro-USD)")]
    PriceTooHigh { max_acceptable_price: u64 },
    #[error("No provider satisfies minimum TPS constraint ({min_tps})")]
    TpsConstraintUnmet { min_tps: f32 },
    #[error("No provider supports requested context window ({requested_tokens} tokens)")]
    ContextTooLarge { requested_tokens: u32 },
    #[error("No provider meets required trust tier ({required:?})")]
    TrustTierUnmet { required: TrustTier },
    #[error("Internal order book error: {0}")]
    Internal(String),
}

/// A Level-2 Order Book for a single model (e.g. "llama-3.3-70b-instruct")
#[derive(Debug)]
pub struct ModelOrderBook {
    pub model: String,
    asks: HashMap<OrderId, AskOrder>,
    provider_asks: HashMap<ProviderId, HashSet<OrderId>>,
    bids: HashMap<OrderId, BidOrder>,
}

impl ModelOrderBook {
    pub fn new(model: String) -> Self {
        Self {
            model,
            asks: HashMap::new(),
            provider_asks: HashMap::new(),
            bids: HashMap::new(),
        }
    }

    /// Add or update an ask quote from a provider
    pub fn upsert_ask(&mut self, ask: AskOrder) {
        let order_id = ask.id;
        let provider_id = ask.provider_id.clone();

        self.provider_asks
            .entry(provider_id)
            .or_default()
            .insert(order_id);

        self.asks.insert(order_id, ask);
    }

    /// Cancel a specific ask
    pub fn cancel_ask(&mut self, ask_id: &OrderId) -> Option<AskOrder> {
        if let Some(removed) = self.asks.remove(ask_id) {
            if let Some(set) = self.provider_asks.get_mut(&removed.provider_id) {
                set.remove(ask_id);
            }
            Some(removed)
        } else {
            None
        }
    }

    /// Remove all asks for a given provider (e.g. upon disconnect)
    pub fn remove_provider(&mut self, provider_id: &ProviderId) -> Vec<AskOrder> {
        let mut removed_asks = Vec::new();
        if let Some(order_ids) = self.provider_asks.remove(provider_id) {
            for id in order_ids {
                if let Some(ask) = self.asks.remove(&id) {
                    removed_asks.push(ask);
                }
            }
        }
        removed_asks
    }

    /// Find and claim the best available slot according to Price-Time-SLA priority
    pub fn claim_best_slot(&mut self, req: &MarketRequest) -> Result<MatchedRoute, MatchError> {
        let required_context = req.estimated_prompt_tokens + req.max_output_tokens;
        let min_trust = req.min_trust.unwrap_or(TrustTier::Community);

        // Find candidate asks
        let mut candidates: Vec<&mut AskOrder> = self
            .asks
            .values_mut()
            .filter(|ask| {
                // Must have spare slot
                ask.is_available()
                    // Must fit context window
                    && ask.max_context_tokens >= required_context
                    // Must satisfy trust tier
                    && ask.trust_tier >= min_trust
            })
            .collect();

        if candidates.is_empty() {
            // Check why no candidate was found for granular error
            let has_any_capacity = self.asks.values().any(|a| a.is_available());
            if !has_any_capacity {
                return Err(MatchError::NoCapacity(self.model.clone()));
            }
            return Err(MatchError::ContextTooLarge {
                requested_tokens: required_context,
            });
        }

        // Filter by min TPS if specified
        if let Some(min_tps) = req.min_tps {
            candidates.retain(|a| a.reported_tps >= min_tps);
            if candidates.is_empty() {
                return Err(MatchError::TpsConstraintUnmet { min_tps });
            }
        }

        // Filter by max acceptable output price if specified
        if let Some(max_p_out) = req.max_acceptable_output_price {
            candidates.retain(|a| a.price_output_per_million <= max_p_out);
            if candidates.is_empty() {
                return Err(MatchError::PriceTooHigh {
                    max_acceptable_price: max_p_out,
                });
            }
        }

        // Sort candidates:
        // 1. Lowest Composite Effective Price (P_in + 3 * P_out)
        // 2. Highest reported TPS (tie-breaker)
        // 3. Earliest updated_at (FIFO price-time priority)
        candidates.sort_by(|a, b| {
            a.effective_price()
                .cmp(&b.effective_price())
                .then_with(|| {
                    b.reported_tps
                        .partial_cmp(&a.reported_tps)
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .then_with(|| a.updated_at.cmp(&b.updated_at))
        });

        let winning_ask = &mut candidates[0];
        winning_ask.busy_slots += 1;

        debug!(
            model = %self.model,
            provider_id = %winning_ask.provider_id,
            p_in = winning_ask.price_input_per_million,
            p_out = winning_ask.price_output_per_million,
            busy = winning_ask.busy_slots,
            total = winning_ask.total_slots,
            "Matched and claimed concurrency slot on L2 order book"
        );

        Ok(MatchedRoute {
            ask_id: winning_ask.id,
            provider_id: winning_ask.provider_id.clone(),
            provider_name: winning_ask.provider_name.clone(),
            model: self.model.clone(),
            price_input_per_million: winning_ask.price_input_per_million,
            price_output_per_million: winning_ask.price_output_per_million,
            effective_price: winning_ask.effective_price(),
            reported_tps: winning_ask.reported_tps,
            trust_tier: winning_ask.trust_tier,
        })
    }

    /// Release a busy concurrency slot once inference completes or errors
    pub fn release_slot(&mut self, ask_id: &OrderId) -> bool {
        if let Some(ask) = self.asks.get_mut(ask_id) {
            ask.busy_slots = ask.busy_slots.saturating_sub(1);
            debug!(
                model = %self.model,
                ask_id = %ask_id,
                busy = ask.busy_slots,
                total = ask.total_slots,
                "Released concurrency slot"
            );
            true
        } else {
            false
        }
    }

    /// Generate an aggregated Level-2 depth snapshot
    pub fn get_l2_depth(&self) -> L2DepthSnapshot {
        let mut price_buckets: BTreeMap<u64, (u64, u64, u32, u32, usize)> = BTreeMap::new();
        let mut total_avail = 0;
        let mut total_cap = 0;
        let mut provider_set = HashSet::new();
        let mut weighted_tps_sum = 0.0;

        for ask in self.asks.values() {
            let eff = ask.effective_price();
            let entry = price_buckets.entry(eff).or_insert((
                ask.price_input_per_million,
                ask.price_output_per_million,
                0,
                0,
                0,
            ));
            entry.2 += ask.available_slots();
            entry.3 += ask.total_slots;
            entry.4 += 1;

            total_avail += ask.available_slots();
            total_cap += ask.total_slots;
            provider_set.insert(ask.provider_id.clone());
            weighted_tps_sum += ask.reported_tps * (ask.total_slots as f32);
        }

        let avg_tps = if total_cap > 0 {
            weighted_tps_sum / (total_cap as f32)
        } else {
            0.0
        };

        // Build sorted depth levels
        let asks_depth: Vec<L2PriceLevel> = price_buckets
            .into_iter()
            .map(|(eff, (p_in, p_out, avail, total, p_count))| L2PriceLevel {
                effective_price: eff,
                price_input: p_in,
                price_output: p_out,
                available_slots: avail,
                total_slots: total,
                provider_count: p_count as u32,
            })
            .collect();

        let bbo_effective = asks_depth.first().map(|lvl| lvl.effective_price);
        let bbo_ask_input = asks_depth.first().map(|lvl| lvl.price_input);
        let bbo_ask_output = asks_depth.first().map(|lvl| lvl.price_output);

        L2DepthSnapshot {
            model: self.model.clone(),
            timestamp: Utc::now(),
            bbo_ask_input,
            bbo_ask_output,
            bbo_effective,
            total_available_slots: total_avail,
            total_capacity_slots: total_cap,
            active_providers: provider_set.len() as u32,
            avg_tps,
            asks: asks_depth,
            bids: Vec::new(),
        }
    }
}

/// Global registry managing order books for all active models
#[derive(Debug, Default)]
pub struct ExchangeRegistry {
    books: RwLock<HashMap<String, ModelOrderBook>>,
}

impl ExchangeRegistry {
    pub fn new() -> Self {
        Self {
            books: RwLock::new(HashMap::new()),
        }
    }

    pub fn upsert_ask(&self, ask: AskOrder) {
        let mut books = self.books.write();
        let book = books
            .entry(ask.model.clone())
            .or_insert_with(|| ModelOrderBook::new(ask.model.clone()));
        book.upsert_ask(ask);
    }

    pub fn claim_best_slot(&self, req: &MarketRequest) -> Result<MatchedRoute, MatchError> {
        let mut books = self.books.write();
        let book = books
            .get_mut(&req.model)
            .ok_or_else(|| MatchError::NoCapacity(req.model.clone()))?;
        book.claim_best_slot(req)
    }

    pub fn release_slot(&self, model: &str, ask_id: &OrderId) -> bool {
        let mut books = self.books.write();
        if let Some(book) = books.get_mut(model) {
            book.release_slot(ask_id)
        } else {
            false
        }
    }

    pub fn remove_provider(&self, provider_id: &ProviderId) {
        let mut books = self.books.write();
        for book in books.values_mut() {
            book.remove_provider(provider_id);
        }
    }

    pub fn get_l2_depth(&self, model: &str) -> Option<L2DepthSnapshot> {
        let books = self.books.read();
        books.get(model).map(|b| b.get_l2_depth())
    }

    pub fn list_models_depth(&self) -> Vec<L2DepthSnapshot> {
        let books = self.books.read();
        books.values().map(|b| b.get_l2_depth()).collect()
    }
}
