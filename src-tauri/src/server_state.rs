use std::sync::{Arc, Mutex};
use crate::qr_manager::QrManager;

// Webサーバーとスマホ連携関連の状態を管理
pub struct ServerState {
    pub web_server_port: Arc<Mutex<Option<u16>>>,
    pub qr_manager: Arc<Mutex<Option<Arc<QrManager>>>>,
    pub is_starting: Arc<Mutex<bool>>,
}

impl ServerState {
    pub fn new() -> Self {
        Self {
            web_server_port: Arc::new(Mutex::new(None)),
            qr_manager: Arc::new(Mutex::new(None)),
            is_starting: Arc::new(Mutex::new(false)),
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

    pub fn begin_starting(&self) -> bool {
        let mut guard = self.is_starting.lock().unwrap();
        if *guard {
            false
        } else {
            *guard = true;
            true
        }
    }

    pub fn finish_starting(&self) {
        *self.is_starting.lock().unwrap() = false;
    }
}
