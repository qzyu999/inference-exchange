use ie_gateway_msgs::AskQuote;
use sysinfo::System;
use tracing::debug;

// Dynamic pricing heuristics controller for provider node
pub struct DynamicPricingEngine {
    pub model: String,
    pub base_price_input: u64,
    pub base_price_output: u64,
    pub total_slots: u32,
    pub base_tps: f32,
    pub dynamic_pricing_enabled: bool,
    system: System,
}

impl DynamicPricingEngine {
    pub fn new(
        model: String,
        base_price_input: u64,
        base_price_output: u64,
        total_slots: u32,
        base_tps: f32,
        dynamic_pricing_enabled: bool,
    ) -> Self {
        let mut sys = System::new_all();
        sys.refresh_all();
        Self {
            model,
            base_price_input,
            base_price_output,
            total_slots,
            base_tps,
            dynamic_pricing_enabled,
            system: sys,
        }
    }

    /// Calculate dynamic ask quote based on current local hardware load
    pub fn compute_quote(&mut self) -> AskQuote {
        if !self.dynamic_pricing_enabled {
            return AskQuote {
                model: self.model.clone(),
                price_input_per_million: self.base_price_input,
                price_output_per_million: self.base_price_output,
                total_slots: self.total_slots,
                reported_tps: self.base_tps,
            };
        }

        self.system.refresh_cpu_usage();
        self.system.refresh_memory();

        let cpu_usage = self.system.global_cpu_info().cpu_usage(); // 0.0 - 100.0%
        
        // Multiplier based on load:
        // Idle (0-20%): 0.9x discount (capture volume)
        // Normal (20-60%): 1.0x
        // High load (60-100%): 1.1x - 1.5x surge pricing
        let load_multiplier = if cpu_usage < 20.0 {
            0.90
        } else if cpu_usage < 60.0 {
            1.00
        } else {
            1.0 + ((cpu_usage - 60.0) / 40.0) as f64 * 0.50
        };

        let dynamic_p_in = ((self.base_price_input as f64) * load_multiplier).round() as u64;
        let dynamic_p_out = ((self.base_price_output as f64) * load_multiplier).round() as u64;

        debug!(
            model = %self.model,
            cpu_usage = %cpu_usage,
            multiplier = %load_multiplier,
            p_in = %dynamic_p_in,
            p_out = %dynamic_p_out,
            "Computed dynamic ask quote for L2 Order Book"
        );

        AskQuote {
            model: self.model.clone(),
            price_input_per_million: dynamic_p_in,
            price_output_per_million: dynamic_p_out,
            total_slots: self.total_slots,
            reported_tps: self.base_tps,
        }
    }
}

pub mod ie_gateway_msgs {
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct AskQuote {
        pub model: String,
        pub price_input_per_million: u64,
        pub price_output_per_million: u64,
        pub total_slots: u32,
        pub reported_tps: f32,
    }
}
