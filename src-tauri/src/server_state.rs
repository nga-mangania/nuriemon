use std::sync::{Arc, Mutex};
use crate::qr_manager::QrManager;

// Webサーバーとスマホ連携関連の状態を管理
pub struct ServerState {
    pub web_server_port: Arc<Mutex<Option<u16>>>,
    pub qr_manager: Arc<Mutex<Option<Arc<QrManager>>>>,
}

impl ServerState {
    pub fn new() -> Self {
        Self {
            web_server_port: Arc::new(Mutex::new(None)),
            qr_manager: Arc::new(Mutex::new(None)),
        }
    }
    
    pub fn set_server_port(&self, port: u16) {
        *self.web_server_port.lock().unwrap() = Some(port);
    }
    
    pub fn get_server_port(&self) -> Option<u16> {
        *self.web_server_port.lock().unwrap()
    }
    
    pub fn set_qr_manager(&self, manager: Arc<QrManager>) {
        *self.qr_manager.lock().unwrap() = Some(manager);
    }
    
    pub fn get_qr_manager(&self) -> Option<Arc<QrManager>> {
        self.qr_manager.lock().unwrap().clone()
    }
}