use serde::{Serialize, Deserialize};
use tauri::{AppHandle, Manager, Emitter};

// データ変更イベントの種類
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum DataChangeEvent {
    ImageAdded { id: String },
    ImageDeleted { id: String },
    AudioUpdated { audio_type: String }, // "bgm" or "sound_effect"
    BackgroundChanged,
    AnimationSettingsChanged { image_id: String },
    GroundPositionChanged { position: i32 },
    DeletionTimeChanged { time: String },
    AppSettingChanged { key: String, value: String },
}

// イベント発行関数
pub fn emit_data_change(app_handle: &AppHandle, event: DataChangeEvent) -> Result<(), String> {
    println!("[Rust] Emitting event to all windows: {:?}", event);
    
    // すべてのウィンドウにイベントを送信
    let windows = app_handle.webview_windows();
    for (label, _window) in windows {
        println!("[Rust] Emitting to window: {}", label);
    }
    
    app_handle.emit("data-changed", &event)
        .map_err(|e| format!("Failed to emit event: {}", e))?;
    println!("[Rust] Event emitted successfully to all windows");
    Ok(())
}

// 特定のウィンドウにイベントを送信
#[allow(dead_code)]
pub fn emit_to_window(app_handle: &AppHandle, window_label: &str, event: DataChangeEvent) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window(window_label) {
        window.emit("data-changed", &event)
            .map_err(|e| format!("Failed to emit event to window: {}", e))
    } else {
        Err(format!("Window '{}' not found", window_label))
    }
}