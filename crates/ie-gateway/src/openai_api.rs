use crate::provider_hub::{ChatMessage, ClientStreamEvent, GatewayToProviderMsg, ProviderHub};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::Utc;
use ie_core::types::*;
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::sync::Arc;
use tracing::info;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub stream: bool,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionResponse {
    pub id: String,
    pub object: String,
    pub created: i64,
    pub model: String,
    pub choices: Vec<ChatChoice>,
    pub usage: UsageStats,
    pub routing: Option<RoutingMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatChoice {
    pub index: usize,
    pub message: ChatMessage,
    pub finish_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageStats {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingMetadata {
    pub matched_provider_id: String,
    pub matched_provider_name: String,
    pub price_input_per_million_usd: f64,
    pub price_output_per_million_usd: f64,
    pub effective_price_per_million_usd: f64,
    pub total_cost_usd: f64,
    pub trust_tier: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionChunk {
    pub id: String,
    pub object: String,
    pub created: i64,
    pub model: String,
    pub choices: Vec<ChunkChoice>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkChoice {
    pub index: usize,
    pub delta: ChunkDelta,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkDelta {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
}

fn estimate_tokens(messages: &[ChatMessage]) -> u32 {
    let mut total_chars = 0;
    for m in messages {
        total_chars += m.content.len();
    }
    // Rough estimate ~4 chars per token + formatting
    ((total_chars as f32 / 4.0).ceil() as u32).max(1)
}

pub async fn handle_chat_completions(
    State(hub): State<Arc<ProviderHub>>,
    headers: HeaderMap,
    Json(payload): Json<ChatCompletionRequest>,
) -> Result<Response, (StatusCode, Json<serde_json::Value>)> {
    let consumer_id = headers
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .map(|s: &str| s.trim_start_matches("Bearer ").to_string())
        .unwrap_or_else(|| "anonymous-consumer".to_string());

    // Parse custom market headers if provided
    let max_acceptable_p_out: Option<u64> = headers
        .get("X-IE-Max-Price-Output")
        .and_then(|v| v.to_str().ok())
        .and_then(|s: &str| s.parse::<f64>().ok())
        .map(|usd: f64| (usd * 1_000_000.0) as u64);

    let min_tps: Option<f32> = headers
        .get("X-IE-Min-TPS")
        .and_then(|v| v.to_str().ok())
        .and_then(|s: &str| s.parse::<f32>().ok());

    let min_trust: Option<TrustTier> = headers
        .get("X-IE-Min-Trust")
        .and_then(|v| v.to_str().ok())
        .and_then(|s: &str| match s.to_lowercase().as_str() {
            "enclave" | "hardware" => Some(TrustTier::EnclaveAttested),
            "verified" => Some(TrustTier::Verified),
            _ => Some(TrustTier::Community),
        });

    let est_prompt_tokens = estimate_tokens(&payload.messages);
    let max_output_tokens = payload.max_tokens.unwrap_or(2048);

    let market_req = MarketRequest {
        model: payload.model.clone(),
        estimated_prompt_tokens: est_prompt_tokens,
        max_output_tokens,
        max_acceptable_output_price: max_acceptable_p_out,
        min_tps,
        min_trust,
        consumer_id: consumer_id.clone(),
    };

    // 1. Match on Level-2 Order Book
    let route = hub
        .registry
        .claim_best_slot(&market_req)
        .map_err(|err| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "error": {
                        "message": err.to_string(),
                        "type": "order_book_no_fill",
                        "code": 503
                    }
                })),
            )
        })?;

    info!(
        model = %payload.model,
        provider = %route.provider_name,
        price_in = route.price_input_per_million,
        price_out = route.price_output_per_million,
        "Order Book matched request with Best Offer provider"
    );

    // 2. Pre-flight Escrow Reservation
    let reservation_id = hub
        .escrow
        .reserve_preflight(
            &consumer_id,
            &route.provider_id,
            &route.model,
            est_prompt_tokens,
            max_output_tokens,
            route.price_input_per_million,
            route.price_output_per_million,
        )
        .map_err(|err| {
            hub.registry.release_slot(&route.model, &route.ask_id);
            (
                StatusCode::PAYMENT_REQUIRED,
                Json(serde_json::json!({
                    "error": {
                        "message": err.to_string(),
                        "type": "insufficient_funds",
                        "code": 402
                    }
                })),
            )
        })?;

    // 3. Register Stream Listener and Dispatch to Provider
    let request_id = Uuid::new_v4();
    let mut rx = hub.register_stream_listener(request_id);

    let dispatch_msg = GatewayToProviderMsg::DispatchInference {
        request_id,
        model: payload.model.clone(),
        messages: payload.messages.clone(),
        temperature: payload.temperature,
        max_tokens: payload.max_tokens,
        stream: payload.stream,
    };

    if let Err(e) = hub.dispatch_to_provider(&route.provider_id, dispatch_msg) {
        hub.escrow.release_on_error(reservation_id);
        hub.registry.release_slot(&route.model, &route.ask_id);
        hub.remove_stream_listener(&request_id);
        return Err((
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({
                "error": {
                    "message": format!("Provider communication failed: {}", e),
                    "type": "provider_unavailable",
                    "code": 502
                }
            })),
        ));
    }

    let cmpl_id = format!("chatcmpl-{}", Uuid::new_v4().simple());
    let created_ts = Utc::now().timestamp();

    // 4. Handle Streaming Response
    if payload.stream {
        let hub_clone = hub.clone();
        let route_clone = route.clone();
        let model_str = payload.model.clone();

        let stream = async_stream::stream! {
            let mut total_output_tokens = 0u64;
            let mut final_input_tokens = est_prompt_tokens as u64;

            // Emit initial role chunk
            let initial_chunk = ChatCompletionChunk {
                id: cmpl_id.clone(),
                object: "chat.completion.chunk".to_string(),
                created: created_ts,
                model: model_str.clone(),
                choices: vec![ChunkChoice {
                    index: 0,
                    delta: ChunkDelta {
                        role: Some("assistant".to_string()),
                        content: None,
                    },
                    finish_reason: None,
                }],
            };
            if let Ok(json_str) = serde_json::to_string(&initial_chunk) {
                yield Ok::<_, Infallible>(Event::default().data(json_str));
            }

            while let Some(event) = rx.recv().await {
                match event {
                    ClientStreamEvent::Chunk(text) => {
                        let chunk = ChatCompletionChunk {
                            id: cmpl_id.clone(),
                            object: "chat.completion.chunk".to_string(),
                            created: created_ts,
                            model: model_str.clone(),
                            choices: vec![ChunkChoice {
                                index: 0,
                                delta: ChunkDelta {
                                    role: None,
                                    content: Some(text),
                                },
                                finish_reason: None,
                            }],
                        };
                        if let Ok(json_str) = serde_json::to_string(&chunk) {
                            yield Ok(Event::default().data(json_str));
                        }
                    }
                    ClientStreamEvent::Complete { input_tokens, output_tokens, finish_reason } => {
                        final_input_tokens = input_tokens.max(final_input_tokens);
                        total_output_tokens = output_tokens;

                        let final_chunk = ChatCompletionChunk {
                            id: cmpl_id.clone(),
                            object: "chat.completion.chunk".to_string(),
                            created: created_ts,
                            model: model_str.clone(),
                            choices: vec![ChunkChoice {
                                index: 0,
                                delta: ChunkDelta {
                                    role: None,
                                    content: None,
                                },
                                finish_reason: Some(finish_reason),
                            }],
                        };
                        if let Ok(json_str) = serde_json::to_string(&final_chunk) {
                            yield Ok(Event::default().data(json_str));
                        }
                        yield Ok(Event::default().data("[DONE]"));
                        break;
                    }
                    ClientStreamEvent::Error(err_msg) => {
                        let err_json = serde_json::json!({
                            "error": { "message": err_msg }
                        });
                        yield Ok(Event::default().data(err_json.to_string()));
                        break;
                    }
                }
            }

            // Stream done: settle escrow and release slot
            hub_clone.remove_stream_listener(&request_id);
            hub_clone.registry.release_slot(&route_clone.model, &route_clone.ask_id);

            if let Ok(receipt) = hub_clone.escrow.settle(reservation_id, final_input_tokens, total_output_tokens) {
                hub_clone.market_feed.publish(MarketEvent::TradeExecuted { receipt });
            }
        };

        Ok(Sse::new(stream).keep_alive(KeepAlive::default()).into_response())
    } else {
        // 5. Handle Non-Streaming Response (Buffered)
        let mut full_content = String::new();
        let mut total_output_tokens = 0u64;
        let mut final_input_tokens = est_prompt_tokens as u64;
        let mut finish_reason_str = "stop".to_string();

        while let Some(event) = rx.recv().await {
            match event {
                ClientStreamEvent::Chunk(text) => {
                    full_content.push_str(&text);
                }
                ClientStreamEvent::Complete { input_tokens, output_tokens, finish_reason } => {
                    final_input_tokens = input_tokens.max(final_input_tokens);
                    total_output_tokens = output_tokens;
                    finish_reason_str = finish_reason;
                    break;
                }
                ClientStreamEvent::Error(err_msg) => {
                    hub.remove_stream_listener(&request_id);
                    hub.escrow.release_on_error(reservation_id);
                    hub.registry.release_slot(&route.model, &route.ask_id);
                    return Err((
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(serde_json::json!({
                            "error": { "message": err_msg }
                        })),
                    ));
                }
            }
        }

        hub.remove_stream_listener(&request_id);
        hub.registry.release_slot(&route.model, &route.ask_id);

        let receipt = hub
            .escrow
            .settle(reservation_id, final_input_tokens, total_output_tokens)
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": { "message": e.to_string() } })),
                )
            })?;

        hub.market_feed.publish(MarketEvent::TradeExecuted { receipt: receipt.clone() });

        let resp = ChatCompletionResponse {
            id: cmpl_id,
            object: "chat.completion".to_string(),
            created: created_ts,
            model: payload.model,
            choices: vec![ChatChoice {
                index: 0,
                message: ChatMessage {
                    role: "assistant".to_string(),
                    content: full_content,
                },
                finish_reason: finish_reason_str,
            }],
            usage: UsageStats {
                prompt_tokens: final_input_tokens,
                completion_tokens: total_output_tokens,
                total_tokens: final_input_tokens + total_output_tokens,
            },
            routing: Some(RoutingMetadata {
                matched_provider_id: route.provider_id,
                matched_provider_name: route.provider_name,
                price_input_per_million_usd: route.price_input_per_million as f64 / 1_000_000.0,
                price_output_per_million_usd: route.price_output_per_million as f64 / 1_000_000.0,
                effective_price_per_million_usd: route.effective_price as f64 / 1_000_000.0,
                total_cost_usd: receipt.total_cost_micro_usd as f64 / 1_000_000.0,
                trust_tier: format!("{:?}", route.trust_tier),
            }),
        };

        Ok(Json(resp).into_response())
    }
}
