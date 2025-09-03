use actix_web::{web, Error, HttpRequest, HttpResponse};
use std::time::{Duration, Instant};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use crate::web_server::WebServerState;
use tauri::{Emitter, Manager};
use crate::server_state::ServerState;

#[derive(Serialize, Deserialize, Debug)]
struct WebSocketMessage {
    #[serde(rename = "type")]
    msg_type: String,
    #[serde(default)]
    payload: serde_json::Value,
    // Relay互換のトップレベルフィールド（joinなど）
    #[serde(default)]
    sid: Option<String>,
    #[serde(default, rename = "imageId")]
    image_id_top: Option<String>,
}

pub async fn websocket_handler(
    req: HttpRequest,
    stream: web::Payload,
    data: web::Data<WebServerState>,
) -> Result<HttpResponse, Error> {
    let (res, mut session, stream) = actix_ws::handle(&req, stream)?;
    
    let app_handle = data.app_handle.clone();
    println!("[websocket] WS connection established from {:?}", req.peer_addr());
    
    actix_web::rt::spawn(async move {
        let mut stream = stream
            .aggregate_continuations()
            .max_continuation_size(2_usize.pow(20));

        let mut last_heartbeat = Instant::now();
        let heartbeat_interval = Duration::from_secs(5);

        loop {
            tokio::select! {
                Some(msg) = stream.next() => {
                    // Log approximate size/type to debug
                    // Note: avoid dumping large payloads in production
                    match msg {
                        Ok(actix_ws::AggregatedMessage::Text(text)) => {
                            println!("[websocket] Received text: {}", text);
                            last_heartbeat = Instant::now();
                            
                            // メッセージをパース
                            if let Ok(ws_msg) = serde_json::from_str::<WebSocketMessage>(&text) {
                                handle_websocket_message(&app_handle, ws_msg, &mut session).await;
                            }
                        }
                        Ok(actix_ws::AggregatedMessage::Ping(bytes)) => {
                            // debug: suppress noisy ping logs
                            last_heartbeat = Instant::now();
                            if session.pong(&bytes).await.is_err() {
                                break;
                            }
                        }
                        Ok(actix_ws::AggregatedMessage::Pong(_)) => {
                            // debug: suppress noisy pong logs
                            last_heartbeat = Instant::now();
                        }
                        Ok(actix_ws::AggregatedMessage::Close(reason)) => {
                            println!("[websocket] Close: {:?}", reason);
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
        "connect" => {
            // モバイル接続のハンドシェイク
            if let Some(session_id) = msg.payload.get("sessionId").and_then(|v| v.as_str()) {
                let provided_image_id = msg.payload.get("imageId").and_then(|v| v.as_str());

                // QrManagerでセッション検証
                let state: tauri::State<ServerState> = app_handle.state();
                if let Some(qr_manager) = state.get_qr_manager() {
                    if let Some(valid_image_id) = qr_manager.validate_session(session_id) {
                        // imageId一致チェック（提供されている場合）
                        if let Some(img) = provided_image_id {
                            if img != valid_image_id {
                                let _ = session.text(serde_json::json!({
                                    "type": "error",
                                    "message": "imageId mismatch"
                                }).to_string()).await;
                                return;
                            }
                        }

                        // 接続完了通知（レガシー互換: connected）
                        let _ = session.text(serde_json::json!({
                            "type": "connected",
                            "imageId": valid_image_id
                        }).to_string()).await;

                        // Tauriイベントを発火（QRウィンドウ等へ通知）
                        let _ = app_handle.emit("mobile-connected", serde_json::json!({
                            "sessionId": session_id,
                            "imageId": valid_image_id,
                        }));
                    } else {
                        let _ = session.text(serde_json::json!({
                            "type": "error",
                            "message": "invalid or expired session"
                        }).to_string()).await;
                    }
                }
            }
        }
        "join" => {
            // Relay互換のハンドシェイク（ackを返す）
            let sid_opt = msg.sid.as_deref().or_else(|| msg.payload.get("sid").and_then(|v| v.as_str()));
            if let Some(sid) = sid_opt {
                let provided_image_id = msg.image_id_top.as_deref()
                    .or_else(|| msg.payload.get("imageId").and_then(|v| v.as_str()));
                let state: tauri::State<ServerState> = app_handle.state();
                if let Some(qr_manager) = state.get_qr_manager() {
                    if let Some(valid_image_id) = qr_manager.validate_session(sid) {
                        if let Some(img) = provided_image_id {
                            if img != valid_image_id {
                                let _ = session.text(serde_json::json!({
                                    "type": "ack",
                                    "ok": false,
                                    "error": "imageId mismatch"
                                }).to_string()).await; return;
                            }
                        }
                        // ack
                        let _ = session.text(serde_json::json!({
                            "type": "ack",
                            "ok": true
                        }).to_string()).await;
                        // 通知
                        let _ = app_handle.emit("mobile-connected", serde_json::json!({
                            "sessionId": sid,
                            "imageId": valid_image_id,
                        }));
                        return;
                    }
                }
                let _ = session.text(serde_json::json!({
                    "type": "ack",
                    "ok": false,
                    "error": "invalid or expired session"
                }).to_string()).await;
            }
        }
        "cmd" => {
            // レガシー/別UI互換: payload.cmd を action/move/emote に正規化
            if let Some(cmd) = msg.payload.get("cmd").and_then(|v| v.as_str()) {
                handle_cmd_string(app_handle, session, cmd, msg.payload.get("imageId")).await;
            }
        }
        "evt" => {
            // さらにレガシー: { type: 'evt', echo: { type: 'cmd', payload: { cmd } } }
            if let Some(echo) = msg.payload.get("echo") {
                let cmd = echo.get("payload").and_then(|p| p.get("cmd")).and_then(|v| v.as_str());
                if let Some(c) = cmd {
                    handle_cmd_string(app_handle, session, c, echo.get("payload").and_then(|p| p.get("imageId"))).await;
                }
            }
        }
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
                println!("[websocket] action received: {:?} for imageId={:?}", action_type, msg.payload.get("imageId"));
                let _ = app_handle.emit("mobile-control", serde_json::json!({
                    "type": "action",
                    "actionType": action_type,
                    "imageId": msg.payload.get("imageId"),
                }));
            }
        }
        "emote" => {
            // エモートコマンドの処理
            if let Some(mut emote_type) = msg.payload.get("emoteType").and_then(|v| v.as_str()) {
                // コントローラーの別名を絵文字へ正規化
                let lower = emote_type.to_lowercase();
                emote_type = match lower.as_str() {
                    "happy" => "😊",
                    "heart" => "❤️",
                    "rock" | "gu" | "✊" => "✊",
                    "scissors" | "choki" | "✌" | "✌️" => "✌️",
                    "paper" | "hand" | "pa" | "🖐" => "🖐",
                    _ => emote_type,
                };
                println!("[websocket] emote received: {:?} for imageId={:?}", emote_type, msg.payload.get("imageId"));
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

async fn handle_cmd_string(
    app_handle: &tauri::AppHandle,
    session: &mut actix_ws::Session,
    cmd: &str,
    image_id_val: Option<&serde_json::Value>,
) {
    // cmd 例: 'jump', 'left', 'right', 'emote:happy'
    if let Some(rest) = cmd.strip_prefix("emote:") {
        let _ = app_handle.emit("mobile-control", serde_json::json!({
            "type": "emote",
            "emoteType": rest,
            "imageId": image_id_val,
        }));
        return;
    }

    match cmd {
        "left" | "right" | "up" | "down" => {
            let _ = app_handle.emit("mobile-control", serde_json::json!({
                "type": "move",
                "direction": cmd,
                "imageId": image_id_val,
            }));
        }
        // その他はアクション扱い
        other => {
            let _ = app_handle.emit("mobile-control", serde_json::json!({
                "type": "action",
                "actionType": other,
                "imageId": image_id_val,
            }));
        }
    }
}
