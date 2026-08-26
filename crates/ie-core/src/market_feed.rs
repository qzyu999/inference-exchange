use crate::types::MarketEvent;
use tokio::sync::broadcast;

#[derive(Clone, Debug)]
pub struct MarketFeed {
    sender: broadcast::Sender<MarketEvent>,
}

impl MarketFeed {
    pub fn new(capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(capacity);
        Self { sender }
    }

    pub fn publish(&self, event: MarketEvent) {
        let _ = self.sender.send(event);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<MarketEvent> {
        self.sender.subscribe()
    }
}

impl Default for MarketFeed {
    fn default() -> Self {
        Self::new(2048)
    }
}
