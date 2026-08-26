mod models_api;
mod openai_api;
mod provider_hub;

use axum::extract::ws::WebSocketUpgrade;
use axum::extract::State;
use axum::response::Html;
use axum::response::Response;
use axum::routing::{get, post};
use axum::Router;
use clap::Parser;
use ie_core::{EscrowLedger, ExchangeRegistry, MarketFeed};
use provider_hub::ProviderHub;
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::info;

#[derive(Parser, Debug)]
#[command(name = "ie-gateway", about = "Inference Exchange Core Gateway & L2 Matching Engine")]
struct Cli {
    #[arg(long, default_value = "0.0.0.0", env = "IE_HOST")]
    host: String,

    #[arg(short, long, default_value_t = 8080, env = "IE_PORT")]
    port: u16,

    #[arg(long, default_value_t = 100, env = "IE_FEE_BPS")]
    protocol_fee_bps: u32,
}

async fn handle_provider_tunnel_ws(
    ws: WebSocketUpgrade,
    State(hub): State<Arc<ProviderHub>>,
) -> Response {
    ws.on_upgrade(|socket| hub.handle_provider_socket(socket))
}

async fn handle_root_ui() -> Html<&'static str> {
    Html(include_str!("../../../web/index.html"))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,ie_gateway=debug,ie_core=debug".into()),
        )
        .init();

    let args = Cli::parse();

    info!("Initializing Inference Exchange Core Matching Engine & Escrow Ledger...");

    let registry = Arc::new(ExchangeRegistry::new());
    let escrow = Arc::new(EscrowLedger::new(args.protocol_fee_bps));
    let market_feed = Arc::new(MarketFeed::new(4096));
    let hub = Arc::new(ProviderHub::new(registry, escrow, market_feed));

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        // Web UI
        .route("/", get(handle_root_ui))
        // OpenAI Compatible API
        .route("/v1/chat/completions", post(openai_api::handle_chat_completions))
        .route("/v1/models", get(models_api::list_models))
        .route("/v1/account/balance", get(models_api::get_account_balance))
        // Market & Order Book API
        .route("/v1/orderbook/:model", get(models_api::get_orderbook_depth))
        .route("/v1/market/feed", get(models_api::handle_market_feed_ws))
        // Provider Inbound Tunnel
        .route("/v1/provider/tunnel", get(handle_provider_tunnel_ws))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(hub);

    let addr: SocketAddr = format!("{}:{}", args.host, args.port).parse()?;
    info!("🚀 Inference Exchange Gateway listening on http://{}", addr);
    info!("   - OpenAI Endpoint: http://{}/v1/chat/completions", addr);
    info!("   - L2 Market Feed:  ws://{}/v1/market/feed", addr);
    info!("   - Provider Tunnel: ws://{}/v1/provider/tunnel", addr);
    info!("   - Exchange UI:     http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
