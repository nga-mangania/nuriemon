use local_ip_address::{list_afinet_netifas, local_ip};
use qrcode::{Color, QrCode};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use uuid::Uuid;

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

    // 利用可能なローカルIPから、スマホが到達しやすいホストを選ぶ
    fn choose_preferred_host() -> String {
        // 候補を列挙（インターフェース名 -> IP）
        if let Ok(map) = list_afinet_netifas() {
            let mut candidates: Vec<(i32, String, String)> = Vec::new();
            for (name, ip) in map.into_iter() {
                // IPv4のみ対象
                let std::net::IpAddr::V4(v4) = ip else {
                    continue;
                };
                // ループバック/リンクローカルは除外
                if v4.is_loopback() || v4.octets()[0] == 169 {
                    continue;
                }

                // 優先度（小さいほど優先）: Wi-Fi(en*) < 有線(eth*) < 無線(wl*) < それ以外
                let mut score = 100;
                let lower = name.to_lowercase();
                if lower.starts_with("en") {
                    score = 10;
                } else if lower.starts_with("eth") {
                    score = 20;
                } else if lower.starts_with("wl") {
                    score = 30;
                }

                // 明示的に除外したい仮想/特殊IFはスコアを下げない（実質候補外）
                if lower.starts_with("awdl")
                    || lower.starts_with("llw")
                    || lower.starts_with("utun")
                    || lower.contains("bridge")
                {
                    continue;
                }

                candidates.push((score, name, v4.to_string()));
            }

            if let Some((_, _name, ip)) = candidates.into_iter().min_by_key(|c| c.0) {
                return ip;
            }
        }

        // フォールバック: 既存の local_ip
        local_ip()
            .map(|ip| ip.to_string())
            .unwrap_or_else(|_| "localhost".to_string())
    }

    pub fn create_session(&self, image_id: &str) -> (String, String) {
        let session_id = Uuid::new_v4().to_string();
        let session = QrSession {
            session_id: session_id.clone(),
            image_id: image_id.to_string(),
            created_at: Instant::now(),
            connected: false,
        };

        self.sessions
            .lock()
            .unwrap()
            .insert(session_id.clone(), session);

        // QRコード用のURLを生成
        let host = Self::choose_preferred_host();
        let url = format!(
            "http://{}:{}/app?session={}&image={}",
            host, self.server_port, session_id, image_id
        );
        println!("[qr] Generated URL: {}", url);

        // QRコードを生成
        let qr_code = generate_qr_code(&url);

        (session_id, qr_code)
    }

    pub fn validate_session(&self, session_id: &str) -> Option<String> {
        let mut sessions = self.sessions.lock().unwrap();

        // セッションのクリーンアップ（長期間放置のみ削除）
        // 有効期限は撤廃するため、24時間以上経過したものだけを掃除
        let now = Instant::now();
        sessions.retain(|_, session| {
            now.duration_since(session.created_at) < Duration::from_secs(24 * 60 * 60)
        });

        if let Some(session) = sessions.get_mut(session_id) {
            // 有効期限を設けず常に許可（固定QR仕様）
            session.connected = true;
            return Some(session.image_id.clone());
        }

        None
    }

    pub fn get_session_status(&self, session_id: &str) -> Option<(bool, Duration)> {
        let sessions = self.sessions.lock().unwrap();
        sessions.get(session_id).map(|session| {
            // タイマー表記は廃止するが、互換のため大きな残り時間を返す
            // UI側でカウントダウンは表示しない
            let remaining = Duration::from_secs(24 * 60 * 60);
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
    use base64::{engine::general_purpose, Engine as _};
    let encoded = general_purpose::STANDARD.encode(svg);
    format!("data:image/svg+xml;base64,{}", encoded)
}
