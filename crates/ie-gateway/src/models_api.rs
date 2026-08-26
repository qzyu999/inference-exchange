use crate::provider_hub::ProviderHub;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::Json;
use chrono::Utc;
use futures_util::StreamExt;
use ie_core::types::*;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, Serialize, Deserialize)]
pub struct ModelListResponse {
    pub object: String,
    pub data: Vec<ModelItem>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModelItem {
    pub id: String,
    pub object: String,
    pub created: i64,
    pub owned_by: String,
    pub market_data: MarketDataMeta,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MarketDataMeta {
    pub bbo_input_price_per_million_usd: Option<f64>,
    pub bbo_output_price_per_million_usd: Option<f64>,
    pub total_available_slots: u32,
    pub total_capacity_slots: u32,
    pub active_providers: u32,
    pub avg_tps: f32,
}

pub async fn list_models(State(hub): State<Arc<ProviderHub>>) -> Json<ModelListResponse> {
    let snapshots = hub.registry.list_models_depth();
    let now = Utc::now().timestamp();

    let data = snapshots
        .into_iter()
        .map(|s| ModelItem {
            id: s.model.clone(),
            object: "model".to_string(),
            created: now,
            owned_by: "inference-exchange".to_string(),
            market_data: MarketDataMeta {
                bbo_input_price_per_million_usd: s.bbo_ask_input.map(|p| p as f64 / 1_000_000.0),
                bbo_output_price_per_million_usd: s.bbo_ask_output.map(|p| p as f64 / 1_000_000.0),
                total_available_slots: s.total_available_slots,
                total_capacity_slots: s.total_capacity_slots,
                active_providers: s.active_providers,
                avg_tps: s.avg_tps,
            },
        })
        .collect();

    Json(ModelListResponse {
        object: "list".to_string(),
        data,
    })
}

pub async fn get_orderbook_depth(
    State(hub): State<Arc<ProviderHub>>,
    Path(model): Path<String>,
) -> Result<Json<L2DepthSnapshot>, (StatusCode, Json<serde_json::Value>)> {
    if let Some(snapshot) = hub.registry.get_l2_depth(&model) {
        Ok(Json(snapshot))
    } else {
        Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "error": {
                    "message": format!("Model '{}' not found in active order books", model),
                    "code": 404
                }
            })),
        ))
    }
}

pub async fn get_account_balance(
    State(hub): State<Arc<ProviderHub>>,
    headers: HeaderMap,
) -> Json<serde_json::Value> {
    let consumer_id = headers
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .map(|s: &str| s.trim_start_matches("Bearer ").to_string())
        .unwrap_or_else(|| "anonymous-consumer".to_string());

    let acc = hub.escrow.get_or_create_account(&consumer_id);

    Json(serde_json::json!({
        "account_id": acc.id,
        "balance_usd": acc.balance_micro_usd as f64 / 1_000_000.0,
        "locked_usd": acc.locked_micro_usd as f64 / 1_000_000.0,
        "available_usd": acc.available() as f64 / 1_000_000.0,
        "total_spent_usd": acc.total_spent_micro_usd as f64 / 1_000_000.0,
        "total_earned_usd": acc.total_earned_micro_usd as f64 / 1_000_000.0,
    }))
}

pub async fn handle_market_feed_ws(
    ws: WebSocketUpgrade,
    State(hub): State<Arc<ProviderHub>>,
) -> Response {
    ws.on_upgrade(|socket| handle_feed_socket(socket, hub))
}

async fn handle_feed_socket(mut socket: WebSocket, hub: Arc<ProviderHub>) {
    let mut rx = hub.market_feed.subscribe();

    // Send initial snapshot of all active order books
    let initial_models = hub.registry.list_models_depth();
    for snapshot in initial_models {
        let msg = MarketEvent::DepthUpdated {
            model: snapshot.model.clone(),
            snapshot,
        };
        if let Ok(text) = serde_json::to_string(&msg) {
            let _ = socket.send(Message::Text(text)).await;
        }
    }

    loop {
        tokio::select! {
            Ok(event) = rx.recv() => {
                if let Ok(text) = serde_json::to_string(&event) {
                    if socket.send(Message::Text(text)).await.is_err() {
                        break;
                    }
                }
            }
            inbound = socket.next() => {
                if inbound.is_none() {
                    break;
                }
            }
        }
    }
}
