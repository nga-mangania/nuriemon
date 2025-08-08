use actix_web::{web, Error, HttpRequest, HttpResponse};
use std::time::{Duration, Instant};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use crate::web_server::WebServerState;
use tauri::Emitter;

#[derive(Serialize, Deserialize, Debug)]
struct WebSocketMessage {
    #[serde(rename = "type")]
    msg_type: String,
    payload: serde_json::Value,
}

pub async fn websocket_handler(
    req: HttpRequest,
    stream: web::Payload,
    data: web::Data<WebServerState>,
) -> Result<HttpResponse, Error> {
    let (res, mut session, stream) = actix_ws::handle(&req, stream)?;
    
    let app_handle = data.app_handle.clone();
    
    actix_web::rt::spawn(async move {
        let mut stream = stream
            .aggregate_continuations()
            .max_continuation_size(2_usize.pow(20));

        let mut last_heartbeat = Instant::now();
        let heartbeat_interval = Duration::from_secs(5);

        loop {
            tokio::select! {
                Some(msg) = stream.next() => {
                    match msg {
                        Ok(actix_ws::AggregatedMessage::Text(text)) => {
                            last_heartbeat = Instant::now();
                            
                            // メッセージをパース
                            if let Ok(ws_msg) = serde_json::from_str::<WebSocketMessage>(&text) {
                                handle_websocket_message(&app_handle, ws_msg, &mut session).await;
                            }
                        }
                        Ok(actix_ws::AggregatedMessage::Ping(bytes)) => {
                            last_heartbeat = Instant::now();
                            if session.pong(&bytes).await.is_err() {
                                break;
                            }
                        }
                        Ok(actix_ws::AggregatedMessage::Pong(_)) => {
                            last_heartbeat = Instant::now();
                        }
                        Ok(actix_ws::AggregatedMessage::Close(reason)) => {
                            let _ = session.close(reason).await;
                            break;
                        }
                        _ => {}
                    }
                }
                _ = tokio::time::sleep(heartbeat_interval) => {
                    if Instant::now().duration_since(last_heartbeat) > heartbeat_interval * 2 {
                        println!("WebSocketクライアントがタイムアウトしました");
                        break;
                    }
                    
                    if session.ping(b"ping").await.is_err() {
                        break;
                    }
                }
            }
        }
    });

    Ok(res)
}

async fn handle_websocket_message(
    app_handle: &tauri::AppHandle,
    msg: WebSocketMessage,
    session: &mut actix_ws::Session,
) {
    match msg.msg_type.as_str() {
        "move" => {
            // 移動コマンドの処理
            if let Some(direction) = msg.payload.get("direction").and_then(|v| v.as_str()) {
                let _ = app_handle.emit("mobile-control", serde_json::json!({
                    "type": "move",
                    "direction": direction,
                    "imageId": msg.payload.get("imageId"),
                }));
            }
        }
        "action" => {
            // アクションコマンドの処理
            if let Some(action_type) = msg.payload.get("actionType").and_then(|v| v.as_str()) {
                let _ = app_handle.emit("mobile-control", serde_json::json!({
                    "type": "action",
                    "actionType": action_type,
                    "imageId": msg.payload.get("imageId"),
                }));
            }
        }
        "emote" => {
            // エモートコマンドの処理
            if let Some(emote_type) = msg.payload.get("emoteType").and_then(|v| v.as_str()) {
                let _ = app_handle.emit("mobile-control", serde_json::json!({
                    "type": "emote",
                    "emoteType": emote_type,
                    "imageId": msg.payload.get("imageId"),
                }));
            }
        }
        "keepalive" => {
            // キープアライブメッセージには応答を返す
            let response = serde_json::json!({
                "type": "keepalive",
                "timestamp": chrono::Utc::now().timestamp(),
            });
            let _ = session.text(response.to_string()).await;
        }
        _ => {
            println!("未知のWebSocketメッセージタイプ: {}", msg.msg_type);
        }
    }
}