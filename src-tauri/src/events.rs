use serde::{Serialize, Deserialize};
use tauri::{AppHandle, Manager, Emitter};

use crate::db::ImageMetadata;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ImageUpsertedPayload {
    pub id: String,
    pub original_file_name: String,
    pub saved_file_name: String,
    pub image_type: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_started_at: Option<String>,
}

impl From<&ImageMetadata> for ImageUpsertedPayload {
    fn from(meta: &ImageMetadata) -> Self {
        Self {
            id: meta.id.clone(),
            original_file_name: meta.original_file_name.clone(),
            saved_file_name: meta.saved_file_name.clone(),
            image_type: meta.image_type.clone(),
            created_at: meta.created_at.clone(),
            display_started_at: meta.display_started_at.clone(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ImageDeletedPayload {
    pub id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AudioUpdatedPayload {
    pub audio_type: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AnimationSettingsChangedPayload {
    pub image_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GroundPositionChangedPayload {
    pub position: i32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DeletionTimeChangedPayload {
    pub time: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AppSettingChangedPayload {
    pub key: String,
    pub value: String,
}

// データ変更イベントの種類（serdeで type/payload 形式に）
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum DataChangeEvent {
    #[serde(rename = "image-upserted")]
    ImageUpserted(ImageUpsertedPayload),
    #[serde(rename = "image-deleted")]
    ImageDeleted(ImageDeletedPayload),
    #[serde(rename = "audio-updated")]
    AudioUpdated(AudioUpdatedPayload),
    #[serde(rename = "background-changed")]
    BackgroundChanged,
    #[serde(rename = "animation-settings-changed")]
    AnimationSettingsChanged(AnimationSettingsChangedPayload),
    #[serde(rename = "ground-position-changed")]
    GroundPositionChanged(GroundPositionChangedPayload),
    #[serde(rename = "deletion-time-changed")]
    DeletionTimeChanged(DeletionTimeChangedPayload),
    #[serde(rename = "app-setting-changed")]
    AppSettingChanged(AppSettingChangedPayload),
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
