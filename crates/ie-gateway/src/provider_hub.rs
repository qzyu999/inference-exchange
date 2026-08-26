use axum::extract::ws::{Message, WebSocket};
use futures_util::StreamExt;
use ie_core::types::*;
use ie_core::{EscrowLedger, ExchangeRegistry, MarketFeed};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::{error, info, warn};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum ProviderToGatewayMsg {
    Register {
        provider_name: String,
        models: Vec<ModelCapability>,
        trust_tier: TrustTier,
    },
    AskUpdate {
        asks: Vec<AskQuote>,
    },
    InferenceChunk {
        request_id: Uuid,
        content: String,
        index: usize,
    },
    InferenceComplete {
        request_id: Uuid,
        input_tokens: u64,
        output_tokens: u64,
        finish_reason: String,
    },
    InferenceError {
        request_id: Uuid,
        error: String,
    },
    Heartbeat {
        tps: f32,
        load_pct: f32,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelCapability {
    pub model: String,
    pub max_context_tokens: u32,
    pub total_slots: u32,
    pub price_input_per_million: u64,
    pub price_output_per_million: u64,
    pub initial_tps: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AskQuote {
    pub model: String,
    pub price_input_per_million: u64,
    pub price_output_per_million: u64,
    pub total_slots: u32,
    pub reported_tps: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum GatewayToProviderMsg {
    DispatchInference {
        request_id: Uuid,
        model: String,
        messages: Vec<ChatMessage>,
        temperature: Option<f32>,
        max_tokens: Option<u32>,
        stream: bool,
    },
    CancelInference {
        request_id: Uuid,
    },
    Ping,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

pub enum ClientStreamEvent {
    Chunk(String),
    Complete {
        input_tokens: u64,
        output_tokens: u64,
        finish_reason: String,
    },
    Error(String),
}

pub struct ActiveProviderSession {
    pub provider_id: ProviderId,
    pub provider_name: String,
    pub tx: mpsc::UnboundedSender<GatewayToProviderMsg>,
}

#[derive(Clone)]
pub struct ProviderHub {
    pub registry: Arc<ExchangeRegistry>,
    pub escrow: Arc<EscrowLedger>,
    pub market_feed: Arc<MarketFeed>,
    providers: Arc<RwLock<HashMap<ProviderId, ActiveProviderSession>>>,
    pending_streams: Arc<RwLock<HashMap<Uuid, mpsc::UnboundedSender<ClientStreamEvent>>>>,
}

impl ProviderHub {
    pub fn new(
        registry: Arc<ExchangeRegistry>,
        escrow: Arc<EscrowLedger>,
        market_feed: Arc<MarketFeed>,
    ) -> Self {
        Self {
            registry,
            escrow,
            market_feed,
            providers: Arc::new(RwLock::new(HashMap::new())),
            pending_streams: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn register_stream_listener(&self, request_id: Uuid) -> mpsc::UnboundedReceiver<ClientStreamEvent> {
        let (tx, rx) = mpsc::unbounded_channel();
        self.pending_streams.write().insert(request_id, tx);
        rx
    }

    pub fn remove_stream_listener(&self, request_id: &Uuid) {
        self.pending_streams.write().remove(request_id);
    }

    pub fn dispatch_to_provider(
        &self,
        provider_id: &str,
        msg: GatewayToProviderMsg,
    ) -> Result<(), String> {
        let providers = self.providers.read();
        if let Some(session) = providers.get(provider_id) {
            session
                .tx
                .send(msg)
                .map_err(|_| "Failed to dispatch message to provider socket".to_string())
        } else {
            Err(format!("Provider '{}' is not connected", provider_id))
        }
    }

    pub async fn handle_provider_socket(self: Arc<Self>, mut socket: WebSocket) {
        let provider_id = format!("node-{}", Uuid::new_v4().simple());
        let (outbound_tx, mut outbound_rx) = mpsc::unbounded_channel::<GatewayToProviderMsg>();

        info!(provider_id = %provider_id, "New compute provider connecting via WebSocket");

        let mut provider_name = "Anonymous Provider".to_string();
        let mut registered_models: Vec<String> = Vec::new();

        loop {
            tokio::select! {
                // Outbound messages to provider
                Some(msg) = outbound_rx.recv() => {
                    let json_str = match serde_json::to_string(&msg) {
                        Ok(s) => s,
                        Err(e) => {
                            error!("Failed to serialize gateway msg: {}", e);
                            continue;
                        }
                    };
                    if let Err(e) = socket.send(Message::Text(json_str)).await {
                        warn!(provider_id = %provider_id, "Failed to send to provider: {}", e);
                        break;
                    }
                }

                // Inbound messages from provider
                inbound = socket.next() => {
                    let msg = match inbound {
                        Some(Ok(m)) => m,
                        Some(Err(e)) => {
                            warn!(provider_id = %provider_id, "WebSocket read error: {}", e);
                            break;
                        }
                        None => break, // Socket closed
                    };

                    match msg {
                        Message::Text(text) => {
                            let parsed: Result<ProviderToGatewayMsg, _> = serde_json::from_str(&text);
                            match parsed {
                                Ok(ProviderToGatewayMsg::Register { provider_name: name, models, trust_tier }) => {
                                    provider_name = name.clone();
                                    registered_models = models.iter().map(|m| m.model.clone()).collect();

                                    // Store session
                                    self.providers.write().insert(
                                        provider_id.clone(),
                                        ActiveProviderSession {
                                            provider_id: provider_id.clone(),
                                            provider_name: name.clone(),
                                            tx: outbound_tx.clone(),
                                        },
                                    );

                                    // Insert asks into the Order Book
                                    let mut total_slots = 0;
                                    for cap in &models {
                                        total_slots += cap.total_slots;
                                        let ask = AskOrder::new(
                                            provider_id.clone(),
                                            name.clone(),
                                            cap.model.clone(),
                                            cap.price_input_per_million,
                                            cap.price_output_per_million,
                                            cap.total_slots,
                                            cap.max_context_tokens,
                                            cap.initial_tps,
                                            trust_tier,
                                        );
                                        self.registry.upsert_ask(ask);
                                    }

                                    self.market_feed.publish(MarketEvent::ProviderJoined {
                                        provider_id: provider_id.clone(),
                                        provider_name: name.clone(),
                                        models: registered_models.clone(),
                                        total_slots,
                                    });

                                    // Publish updated depth for each model
                                    for model in &registered_models {
                                        if let Some(snapshot) = self.registry.get_l2_depth(model) {
                                            self.market_feed.publish(MarketEvent::DepthUpdated {
                                                model: model.clone(),
                                                snapshot,
                                            });
                                        }
                                    }

                                    info!(
                                        provider_id = %provider_id,
                                        name = %name,
                                        models = ?registered_models,
                                        "Compute provider successfully registered and posted Asks to L2 Order Book"
                                    );
                                }

                                Ok(ProviderToGatewayMsg::AskUpdate { asks }) => {
                                    for quote in asks {
                                        let ask = AskOrder::new(
                                            provider_id.clone(),
                                            provider_name.clone(),
                                            quote.model.clone(),
                                            quote.price_input_per_million,
                                            quote.price_output_per_million,
                                            quote.total_slots,
                                            32768,
                                            quote.reported_tps,
                                            TrustTier::Community,
                                        );
                                        self.registry.upsert_ask(ask);

                                        if let Some(snapshot) = self.registry.get_l2_depth(&quote.model) {
                                            self.market_feed.publish(MarketEvent::DepthUpdated {
                                                model: quote.model.clone(),
                                                snapshot,
                                            });
                                        }
                                    }
                                }

                                Ok(ProviderToGatewayMsg::InferenceChunk { request_id, content, .. }) => {
                                    let listeners = self.pending_streams.read();
                                    if let Some(tx) = listeners.get(&request_id) {
                                        let _ = tx.send(ClientStreamEvent::Chunk(content));
                                    }
                                }

                                Ok(ProviderToGatewayMsg::InferenceComplete { request_id, input_tokens, output_tokens, finish_reason }) => {
                                    let listeners = self.pending_streams.read();
                                    if let Some(tx) = listeners.get(&request_id) {
                                        let _ = tx.send(ClientStreamEvent::Complete {
                                            input_tokens,
                                            output_tokens,
                                            finish_reason,
                                        });
                                    }
                                }

                                Ok(ProviderToGatewayMsg::InferenceError { request_id, error }) => {
                                    let listeners = self.pending_streams.read();
                                    if let Some(tx) = listeners.get(&request_id) {
                                        let _ = tx.send(ClientStreamEvent::Error(error));
                                    }
                                }

                                Ok(ProviderToGatewayMsg::Heartbeat { tps: _, load_pct: _ }) => {
                                    // Heartbeat telemetry
                                }

                                Err(e) => {
                                    warn!("Malformed JSON message from provider: {}", e);
                                }
                            }
                        }
                        Message::Close(_) => break,
                        _ => {}
                    }
                }
            }
        }

        // Cleanup on disconnect
        info!(provider_id = %provider_id, "Provider disconnected. Clearing Asks from Order Book.");
        self.providers.write().remove(&provider_id);
        self.registry.remove_provider(&provider_id);
        self.market_feed.publish(MarketEvent::ProviderLeft {
            provider_id: provider_id.clone(),
        });

        for model in &registered_models {
            if let Some(snapshot) = self.registry.get_l2_depth(model) {
                self.market_feed.publish(MarketEvent::DepthUpdated {
                    model: model.clone(),
                    snapshot,
                });
            }
        }
    }
}
