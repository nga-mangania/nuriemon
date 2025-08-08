use qrcode::{QrCode, Color};
use uuid::Uuid;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use local_ip_address::local_ip;

#[derive(Clone, Debug)]
pub struct QrSession {
    pub session_id: String,
    pub image_id: String,
    pub created_at: Instant,
    pub connected: bool,
}

pub struct QrManager {
    sessions: Arc<Mutex<HashMap<String, QrSession>>>,
    server_port: u16,
}

impl QrManager {
    pub fn new(server_port: u16) -> Self {
        let manager = Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            server_port,
        };

        // 期限切れセッションのクリーンアップタスクを開始
        // TODO: 定期的なクリーンアップを実装
        // 現在は各セッション確認時にクリーンアップを実行

        manager
    }

    pub fn create_session(&self, image_id: &str) -> (String, String) {
        let session_id = Uuid::new_v4().to_string();
        let session = QrSession {
            session_id: session_id.clone(),
            image_id: image_id.to_string(),
            created_at: Instant::now(),
            connected: false,
        };

        self.sessions.lock().unwrap().insert(session_id.clone(), session);

        // QRコード用のURLを生成
        let local_ip = local_ip().unwrap_or_else(|_| "localhost".parse().unwrap());
        let url = format!("http://{}:{}/mobile?session={}&image={}", 
            local_ip, self.server_port, session_id, image_id);

        // QRコードを生成
        let qr_code = generate_qr_code(&url);

        (session_id, qr_code)
    }

    pub fn validate_session(&self, session_id: &str) -> Option<String> {
        let mut sessions = self.sessions.lock().unwrap();
        
        // クリーンアップを実行
        let now = Instant::now();
        sessions.retain(|_, session| {
            now.duration_since(session.created_at) < Duration::from_secs(60)
        });
        
        if let Some(session) = sessions.get_mut(session_id) {
            // 30秒以内のセッションのみ有効
            if session.created_at.elapsed() < Duration::from_secs(30) {
                session.connected = true;
                return Some(session.image_id.clone());
            }
        }
        
        None
    }

    pub fn get_session_status(&self, session_id: &str) -> Option<(bool, Duration)> {
        let sessions = self.sessions.lock().unwrap();
        
        sessions.get(session_id).map(|session| {
            let elapsed = session.created_at.elapsed();
            let remaining = Duration::from_secs(30).saturating_sub(elapsed);
            (session.connected, remaining)
        })
    }
}

fn generate_qr_code(data: &str) -> String {
    let code = QrCode::new(data).unwrap();
    let size = code.width();
    let mut svg = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {} {}" shape-rendering="crispEdges">"#,
        size, size
    );

    for y in 0..size {
        for x in 0..size {
            if code[(x, y)] == Color::Dark {
                svg.push_str(&format!(
                    "<rect x=\"{}\" y=\"{}\" width=\"1\" height=\"1\" fill=\"#000\"/>",
                    x, y
                ));
            }
        }
    }

    svg.push_str("</svg>");
    
    // Base64エンコードしてデータURIとして返す
    use base64::{Engine as _, engine::general_purpose};
    let encoded = general_purpose::STANDARD.encode(svg);
    format!("data:image/svg+xml;base64,{}", encoded)
}