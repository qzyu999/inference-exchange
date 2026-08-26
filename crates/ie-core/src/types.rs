use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub type OrderId = Uuid;
pub type ProviderId = String;
pub type ConsumerId = String;
pub type ReservationId = Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrustTier {
    Community = 0,
    Verified = 1,
    EnclaveAttested = 2,
}

impl Default for TrustTier {
    fn default() -> Self {
        TrustTier::Community
    }
}

/// Ask quote placed by a compute provider offering inference capacity
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AskOrder {
    pub id: OrderId,
    pub provider_id: ProviderId,
    pub provider_name: String,
    pub model: String,
    /// Price per 1,000,000 input tokens in micro-USD ($1.00 = 1,000,000 micro-USD)
    pub price_input_per_million: u64,
    /// Price per 1,000,000 output tokens in micro-USD
    pub price_output_per_million: u64,
    /// Total concurrent inference streams supported
    pub total_slots: u32,
    /// Currently allocated / busy slots
    pub busy_slots: u32,
    /// Maximum context window in tokens supported
    pub max_context_tokens: u32,
    /// Measured or reported average tokens per second
    pub reported_tps: f32,
    /// Hardware & confidentiality attestation level
    pub trust_tier: TrustTier,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl AskOrder {
    pub fn new(
        provider_id: ProviderId,
        provider_name: String,
        model: String,
        price_input_per_million: u64,
        price_output_per_million: u64,
        total_slots: u32,
        max_context_tokens: u32,
        reported_tps: f32,
        trust_tier: TrustTier,
    ) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            provider_id,
            provider_name,
            model,
            price_input_per_million,
            price_output_per_million,
            total_slots,
            busy_slots: 0,
            max_context_tokens,
            reported_tps,
            trust_tier,
            created_at: now,
            updated_at: now,
        }
    }

    /// Compute composite effective price: P_eff = P_in + 3.0 * P_out
    /// Used for indexing and sorting depth in the order book.
    pub fn effective_price(&self) -> u64 {
        self.price_input_per_million + 3 * self.price_output_per_million
    }

    pub fn available_slots(&self) -> u32 {
        self.total_slots.saturating_sub(self.busy_slots)
    }

    pub fn is_available(&self) -> bool {
        self.available_slots() > 0
    }
}

/// Bid order placed by an API consumer or batch compute buyer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BidOrder {
    pub id: OrderId,
    pub consumer_id: ConsumerId,
    pub model: String,
    pub max_price_input_per_million: u64,
    pub max_price_output_per_million: u64,
    pub min_tps: Option<f32>,
    pub min_trust: TrustTier,
    pub budget_micro_usd: u64,
    pub remaining_budget_micro_usd: u64,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
}

/// Incoming market request from standard OpenAI / Anthropic client
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketRequest {
    pub model: String,
    pub estimated_prompt_tokens: u32,
    pub max_output_tokens: u32,
    pub max_acceptable_output_price: Option<u64>,
    pub min_tps: Option<f32>,
    pub min_trust: Option<TrustTier>,
    pub consumer_id: ConsumerId,
}

/// Matched route returned by the matching engine
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchedRoute {
    pub ask_id: OrderId,
    pub provider_id: ProviderId,
    pub provider_name: String,
    pub model: String,
    pub price_input_per_million: u64,
    pub price_output_per_million: u64,
    pub effective_price: u64,
    pub reported_tps: f32,
    pub trust_tier: TrustTier,
}

/// Aggregated Level-2 Depth Snapshot
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct L2DepthSnapshot {
    pub model: String,
    pub timestamp: DateTime<Utc>,
    pub bbo_ask_input: Option<u64>,
    pub bbo_ask_output: Option<u64>,
    pub bbo_effective: Option<u64>,
    pub total_available_slots: u32,
    pub total_capacity_slots: u32,
    pub active_providers: u32,
    pub avg_tps: f32,
    pub asks: Vec<L2PriceLevel>,
    pub bids: Vec<L2PriceLevel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct L2PriceLevel {
    pub effective_price: u64,
    pub price_input: u64,
    pub price_output: u64,
    pub available_slots: u32,
    pub total_slots: u32,
    pub provider_count: u32,
}

/// Settled receipt for an executed inference stream
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettlementReceipt {
    pub reservation_id: ReservationId,
    pub consumer_id: ConsumerId,
    pub provider_id: ProviderId,
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_input_micro_usd: u64,
    pub cost_output_micro_usd: u64,
    pub total_cost_micro_usd: u64,
    pub protocol_fee_micro_usd: u64,
    pub provider_payout_micro_usd: u64,
    pub refunded_micro_usd: u64,
    pub duration_ms: u64,
    pub tps: f32,
    pub settled_at: DateTime<Utc>,
}

/// Market event broadcasted over WebSocket feed
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum MarketEvent {
    DepthUpdated {
        model: String,
        snapshot: L2DepthSnapshot,
    },
    TradeExecuted {
        receipt: SettlementReceipt,
    },
    ProviderJoined {
        provider_id: ProviderId,
        provider_name: String,
        models: Vec<String>,
        total_slots: u32,
    },
    ProviderLeft {
        provider_id: ProviderId,
    },
    TickerUpdate {
        model: String,
        bbo_input: u64,
        bbo_output: u64,
        volume_tokens_24h: u64,
        avg_tps: f32,
    },
}
