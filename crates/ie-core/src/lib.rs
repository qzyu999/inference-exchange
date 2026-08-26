pub mod escrow;
pub mod market_feed;
pub mod orderbook;
pub mod types;

pub use escrow::EscrowLedger;
pub use market_feed::MarketFeed;
pub use orderbook::{ExchangeRegistry, MatchError, ModelOrderBook};
pub use types::*;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_orderbook_matching_and_concurrency() {
        let mut book = ModelOrderBook::new("llama-3.3-70b-instruct".to_string());

        // Provider A: Cheaper ($0.05 / 1M in, $0.20 / 1M out), 2 slots
        let ask_a = AskOrder::new(
            "prov_a".to_string(),
            "Mac Studio M2 Ultra".to_string(),
            "llama-3.3-70b-instruct".to_string(),
            50_000,
            200_000,
            2,
            32768,
            35.0,
            TrustTier::EnclaveAttested,
        );
        let ask_a_id = ask_a.id;
        book.upsert_ask(ask_a);

        // Provider B: More expensive ($0.10 / 1M in, $0.40 / 1M out), 4 slots
        let ask_b = AskOrder::new(
            "prov_b".to_string(),
            "MacBook Pro M4 Max".to_string(),
            "llama-3.3-70b-instruct".to_string(),
            100_000,
            400_000,
            4,
            32768,
            42.0,
            TrustTier::Verified,
        );
        book.upsert_ask(ask_b);

        let req = MarketRequest {
            model: "llama-3.3-70b-instruct".to_string(),
            estimated_prompt_tokens: 1000,
            max_output_tokens: 500,
            max_acceptable_output_price: None,
            min_tps: None,
            min_trust: None,
            consumer_id: "user_1".to_string(),
        };

        // Match 1: Should get Provider A (cheaper)
        let route_1 = book.claim_best_slot(&req).unwrap();
        assert_eq!(route_1.provider_id, "prov_a");
        assert_eq!(route_1.price_input_per_million, 50_000);

        // Match 2: Should still get Provider A (has 2 slots, now 2/2 busy)
        let route_2 = book.claim_best_slot(&req).unwrap();
        assert_eq!(route_2.provider_id, "prov_a");

        // Match 3: Provider A is full (2/2), should automatically spill to Provider B
        let route_3 = book.claim_best_slot(&req).unwrap();
        assert_eq!(route_3.provider_id, "prov_b");
        assert_eq!(route_3.price_input_per_million, 100_000);

        // Release 1 slot from Provider A
        assert!(book.release_slot(&ask_a_id));

        // Match 4: Should get Provider A again since slot was freed!
        let route_4 = book.claim_best_slot(&req).unwrap();
        assert_eq!(route_4.provider_id, "prov_a");

        // L2 Depth inspection
        let depth = book.get_l2_depth();
        assert_eq!(depth.active_providers, 2);
        assert_eq!(depth.total_capacity_slots, 6);
    }

    #[test]
    fn test_escrow_lifecycle() {
        let escrow = EscrowLedger::new(100); // 1% fee

        // Consumer starts with $10.00 (10,000,000 µUSD)
        let acc = escrow.get_or_create_account("user_123");
        assert_eq!(acc.balance_micro_usd, 10_000_000);

        // Preflight hold: 1,000 prompt tokens @ $0.05/1M, 500 max output tokens @ $0.20/1M
        let res_id = escrow
            .reserve_preflight("user_123", "prov_a", "llama-3.3-70b-instruct", 1000, 500, 50_000, 200_000)
            .unwrap();

        // Check locked funds
        let acc_after_lock = escrow.get_or_create_account("user_123");
        assert_eq!(acc_after_lock.locked_micro_usd, 150);
        assert_eq!(acc_after_lock.available(), 10_000_000 - 150);

        // Settle actual output of 200 tokens (instead of 500 max)
        let receipt = escrow.settle(res_id, 1000, 200).unwrap();
        assert_eq!(receipt.total_cost_micro_usd, 90);
        assert_eq!(receipt.refunded_micro_usd, 60);

        // Verify balances after settlement
        let acc_final = escrow.get_or_create_account("user_123");
        assert_eq!(acc_final.locked_micro_usd, 0);
        assert_eq!(acc_final.balance_micro_usd, 10_000_000 - 90);
        assert_eq!(acc_final.total_spent_micro_usd, 90);

        let prov_acc = escrow.get_or_create_account("prov_a");
        assert!(prov_acc.balance_micro_usd >= 89);
    }
}
