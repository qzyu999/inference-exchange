use crate::types::*;
use chrono::Utc;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Instant;
use thiserror::Error;
use tracing::{debug, info};
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum EscrowError {
    #[error("Insufficient balance. Required: {required_micro_usd} µUSD, Available: {available_micro_usd} µUSD")]
    InsufficientBalance {
        required_micro_usd: u64,
        available_micro_usd: u64,
    },
    #[error("Reservation not found: {0}")]
    ReservationNotFound(ReservationId),
    #[error("Account not found: {0}")]
    AccountNotFound(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub balance_micro_usd: u64,
    pub locked_micro_usd: u64,
    pub total_spent_micro_usd: u64,
    pub total_earned_micro_usd: u64,
}

impl Account {
    pub fn new(id: String, initial_balance_micro_usd: u64) -> Self {
        Self {
            id,
            balance_micro_usd: initial_balance_micro_usd,
            locked_micro_usd: 0,
            total_spent_micro_usd: 0,
            total_earned_micro_usd: 0,
        }
    }

    pub fn available(&self) -> u64 {
        self.balance_micro_usd.saturating_sub(self.locked_micro_usd)
    }
}

#[derive(Debug)]
struct ActiveReservation {
    consumer_id: ConsumerId,
    provider_id: ProviderId,
    model: String,
    locked_micro_usd: u64,
    price_input_per_million: u64,
    price_output_per_million: u64,
    start_time: Instant,
}

#[derive(Debug, Default)]
pub struct EscrowLedger {
    accounts: RwLock<HashMap<String, Account>>,
    reservations: RwLock<HashMap<ReservationId, ActiveReservation>>,
    protocol_fee_bps: u32, // e.g. 100 bps = 1.0%
}

impl EscrowLedger {
    pub fn new(protocol_fee_bps: u32) -> Self {
        Self {
            accounts: RwLock::new(HashMap::new()),
            reservations: RwLock::new(HashMap::new()),
            protocol_fee_bps,
        }
    }

    pub fn get_or_create_account(&self, id: &str) -> Account {
        let mut accounts = self.accounts.write();
        accounts
            .entry(id.to_string())
            // Default new accounts with $10.00 (10,000,000 µUSD) demo credit for instant testability
            .or_insert_with(|| Account::new(id.to_string(), 10_000_000))
            .clone()
    }

    pub fn deposit(&self, id: &str, amount_micro_usd: u64) -> Account {
        let mut accounts = self.accounts.write();
        let acc = accounts
            .entry(id.to_string())
            .or_insert_with(|| Account::new(id.to_string(), 0));
        acc.balance_micro_usd += amount_micro_usd;
        acc.clone()
    }

    /// Pre-flight escrow calculation & locking before stream commences
    pub fn reserve_preflight(
        &self,
        consumer_id: &str,
        provider_id: &str,
        model: &str,
        estimated_prompt_tokens: u32,
        max_output_tokens: u32,
        price_input_per_million: u64,
        price_output_per_million: u64,
    ) -> Result<ReservationId, EscrowError> {
        let mut accounts = self.accounts.write();
        let acc = accounts
            .entry(consumer_id.to_string())
            .or_insert_with(|| Account::new(consumer_id.to_string(), 10_000_000));

        // Max potential cost formula: ceil((T_in * P_in + T_out * P_out) / 1,000,000)
        let cost_in = (estimated_prompt_tokens as u64)
            .saturating_mul(price_input_per_million)
            .div_ceil(1_000_000);
        let cost_out = (max_output_tokens as u64)
            .saturating_mul(price_output_per_million)
            .div_ceil(1_000_000);
        let total_required = cost_in.saturating_add(cost_out).max(10); // minimum micro-hold of 10 µUSD

        if acc.available() < total_required {
            return Err(EscrowError::InsufficientBalance {
                required_micro_usd: total_required,
                available_micro_usd: acc.available(),
            });
        }

        acc.locked_micro_usd += total_required;

        let reservation_id = Uuid::new_v4();
        let reservation = ActiveReservation {
            consumer_id: consumer_id.to_string(),
            provider_id: provider_id.to_string(),
            model: model.to_string(),
            locked_micro_usd: total_required,
            price_input_per_million,
            price_output_per_million,
            start_time: Instant::now(),
        };

        self.reservations.write().insert(reservation_id, reservation);

        debug!(
            consumer = %consumer_id,
            locked = %total_required,
            reservation_id = %reservation_id,
            "Locked pre-flight escrow"
        );

        Ok(reservation_id)
    }

    /// Settle exact usage upon stream completion
    pub fn settle(
        &self,
        reservation_id: ReservationId,
        actual_input_tokens: u64,
        actual_output_tokens: u64,
    ) -> Result<SettlementReceipt, EscrowError> {
        let res = self
            .reservations
            .write()
            .remove(&reservation_id)
            .ok_or(EscrowError::ReservationNotFound(reservation_id))?;

        let duration_ms = res.start_time.elapsed().as_millis() as u64;
        let tps = if duration_ms > 0 {
            (actual_output_tokens as f32) / (duration_ms as f32 / 1000.0)
        } else {
            0.0
        };

        let cost_in = actual_input_tokens
            .saturating_mul(res.price_input_per_million)
            .div_ceil(1_000_000);
        let cost_out = actual_output_tokens
            .saturating_mul(res.price_output_per_million)
            .div_ceil(1_000_000);
        let actual_total = cost_in.saturating_add(cost_out).min(res.locked_micro_usd);

        let fee = (actual_total as u128 * self.protocol_fee_bps as u128 / 10_000) as u64;
        let provider_payout = actual_total.saturating_sub(fee);
        let refund = res.locked_micro_usd.saturating_sub(actual_total);

        // Update consumer and provider accounts
        let mut accounts = self.accounts.write();

        if let Some(consumer) = accounts.get_mut(&res.consumer_id) {
            consumer.locked_micro_usd = consumer.locked_micro_usd.saturating_sub(res.locked_micro_usd);
            consumer.balance_micro_usd = consumer.balance_micro_usd.saturating_sub(actual_total);
            consumer.total_spent_micro_usd += actual_total;
        }

        let provider = accounts
            .entry(res.provider_id.clone())
            .or_insert_with(|| Account::new(res.provider_id.clone(), 0));
        provider.balance_micro_usd += provider_payout;
        provider.total_earned_micro_usd += provider_payout;

        let receipt = SettlementReceipt {
            reservation_id,
            consumer_id: res.consumer_id,
            provider_id: res.provider_id,
            model: res.model,
            input_tokens: actual_input_tokens,
            output_tokens: actual_output_tokens,
            cost_input_micro_usd: cost_in,
            cost_output_micro_usd: cost_out,
            total_cost_micro_usd: actual_total,
            protocol_fee_micro_usd: fee,
            provider_payout_micro_usd: provider_payout,
            refunded_micro_usd: refund,
            duration_ms,
            tps,
            settled_at: Utc::now(),
        };

        info!(
            reservation = %reservation_id,
            cost = %actual_total,
            refund = %refund,
            payout = %provider_payout,
            duration_ms = %duration_ms,
            tps = %tps,
            "Settled inference transaction"
        );

        Ok(receipt)
    }

    /// Unlock escrow if the route or stream failed
    pub fn release_on_error(&self, reservation_id: ReservationId) {
        if let Some(res) = self.reservations.write().remove(&reservation_id) {
            let mut accounts = self.accounts.write();
            if let Some(consumer) = accounts.get_mut(&res.consumer_id) {
                consumer.locked_micro_usd = consumer.locked_micro_usd.saturating_sub(res.locked_micro_usd);
                debug!(
                    reservation = %reservation_id,
                    unlocked = %res.locked_micro_usd,
                    "Released locked escrow on failure"
                );
            }
        }
    }
}
