use crate::db::{current_timestamp, ImageMetadata as DbImageMetadata};
use crate::events::{emit_data_change, DataChangeEvent};
use crate::workspace::WorkspaceState;
use base64::{engine::general_purpose, Engine as _};
use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::thread::JoinHandle;
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

// グローバルなwatcher管理
struct WatcherState {
    watcher_thread: Option<JoinHandle<()>>,
    stop_sender: Option<Sender<()>>,
}

static WATCHER_STATE: Lazy<Arc<Mutex<WatcherState>>> = Lazy::new(|| {
    Arc::new(Mutex::new(WatcherState {
        watcher_thread: None,
        stop_sender: None,
    }))
});

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AutoImportStarted {
    pub image_id: String,
    pub original_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AutoImportResult {
    pub image_id: String,
    pub original_path: String,
    pub processed_path: String,
    pub animation_settings: AnimationSettings,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AutoImportError {
    pub image_id: String,
    pub error: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AnimationSettings {
    pub animation_type: String,
    pub speed: f32,
    pub size: f32,
}

pub fn start_folder_watching(
    app_handle: AppHandle,
    watch_path: String,
    workspace_path: String,
) -> Result<(), String> {
    if !Path::new(&watch_path).exists() {
        return Err("指定されたフォルダが存在しません".to_string());
    }

    // 既存のwatcherを停止
    stop_folder_watching();

    let app_handle_clone = app_handle.clone();
    let (stop_tx, stop_rx) = channel::<()>();

    let thread_handle = thread::spawn(move || {
        let (tx, rx) = channel();

        let mut watcher =
            RecommendedWatcher::new(tx, Config::default()).expect("Failed to create watcher");

        watcher
            .watch(Path::new(&watch_path), RecursiveMode::NonRecursive)
            .expect("Failed to watch path");

        println!("Watching folder: {}", watch_path);

        loop {
            // stop_rxをチェック
            if stop_rx.try_recv().is_ok() {
                println!("Stopping folder watcher for: {}", watch_path);
                break;
            }

            // file eventsをチェック（タイムアウト付き）
            match rx.recv_timeout(std::time::Duration::from_millis(100)) {
                Ok(res) => match res {
                    Ok(event) => {
                        if let EventKind::Create(_) = event.kind {
                            for path in event.paths {
                                if is_image_file(&path) {
                                    println!("New image detected: {:?}", path);

                                    let result = process_new_image(
                                        app_handle_clone.clone(),
                                        path.clone(),
                                        workspace_path.clone(),
                                    );

                                    match result {
                                        Ok(_) => println!("Image processed successfully"),
                                        Err(e) => eprintln!("Error processing image: {}", e),
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => eprintln!("Watch error: {:?}", e),
                },
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    // タイムアウトは正常、ループを続ける
                }
                Err(e) => {
                    eprintln!("Channel error: {:?}", e);
                    break;
                }
            }
        }
    });

    // グローバル状態を更新
    let mut state = WATCHER_STATE.lock().unwrap();
    state.watcher_thread = Some(thread_handle);
    state.stop_sender = Some(stop_tx);

    Ok(())
}

pub fn stop_folder_watching() {
    let mut state = WATCHER_STATE.lock().unwrap();

    // 停止シグナルを送信
    if let Some(sender) = state.stop_sender.take() {
        let _ = sender.send(());
    }

    // スレッドの終了を待つ
    if let Some(thread) = state.watcher_thread.take() {
        let _ = thread.join();
    }
}

fn is_image_file(path: &Path) -> bool {
    if let Some(extension) = path.extension() {
        let ext = extension.to_str().unwrap_or("").to_lowercase();
        matches!(
            ext.as_str(),
            "jpg" | "jpeg" | "png" | "gif" | "bmp" | "webp"
        )
    } else {
        false
    }
}

fn process_new_image(
    app_handle: AppHandle,
    image_path: PathBuf,
    workspace_path: String,
) -> Result<(), String> {
    // 画像IDを生成
    let image_id = Uuid::new_v4().to_string();
    let original_path = image_path.to_string_lossy().to_string();

    // 処理開始を通知
    app_handle
        .emit(
            "auto-import-started",
            AutoImportStarted {
                image_id: image_id.clone(),
                original_path: original_path.clone(),
            },
        )
        .map_err(|e| format!("Failed to emit start event: {}", e))?;

    // 画像処理を実行
    let handle_clone = app_handle.clone();
    let image_id_clone = image_id.clone();
    let workspace_path_clone = workspace_path.clone();

    thread::spawn(move || {
        match process_image_async(
            handle_clone.clone(),
            image_path,
            image_id_clone.clone(),
            workspace_path_clone,
        ) {
            Ok(processed_path) => {
                // ランダムアニメーション設定を生成
                let animation = generate_random_animation();

                let result = AutoImportResult {
                    image_id: image_id_clone,
                    original_path,
                    processed_path,
                    animation_settings: animation,
                };

                // 処理完了を通知
                let _ = handle_clone.emit("auto-import-complete", result);
            }
            Err(e) => {
                // エラーを通知
                let _ = handle_clone.emit(
                    "auto-import-error",
                    AutoImportError {
                        image_id: image_id_clone,
                        error: e,
                    },
                );
            }
        }
    });

    Ok(())
}

fn process_image_async(
    app_handle: AppHandle,
    image_path: PathBuf,
    image_id: String,
    workspace_path: String,
) -> Result<String, String> {
    // 画像ファイルを読み込み
    let image_data =
        fs::read(&image_path).map_err(|e| format!("Failed to read image file: {}", e))?;

    // Base64エンコード
    let base64_data = general_purpose::STANDARD.encode(&image_data);

    // ファイル拡張子を取得
    let extension = image_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("png");

    // MIMEタイプを決定
    let mime_type = match extension.to_lowercase().as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "webp" => "image/webp",
        _ => "image/png",
    };

    // データURLを作成
    let data_url = format!("data:{};base64,{}", mime_type, base64_data);

    // Python処理を直接実行
    let result = crate::process_image_sync(data_url)?;

    if !result.success {
        return Err(result.error.unwrap_or_else(|| "Unknown error".to_string()));
    }

    // 処理済み画像を保存
    let processed_data_url = result.image.ok_or("No processed image returned")?;

    // データURLからBase64部分を抽出
    let base64_start = processed_data_url
        .find("base64,")
        .ok_or("Invalid data URL format")?;
    let base64_str = &processed_data_url[base64_start + 7..];

    // Base64をデコード
    let processed_data = general_purpose::STANDARD
        .decode(base64_str)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    // 保存先パスを生成（ワークスペースは既にフルパスなので、そのまま使用）
    let workspace_dir = PathBuf::from(&workspace_path);
    let processed_dir = workspace_dir.join("images").join("processed");

    // ディレクトリを作成
    fs::create_dir_all(&processed_dir).map_err(|e| format!("Failed to create directory: {}", e))?;

    // ファイル名を生成
    let filename = format!("{}.png", image_id);
    let save_path = processed_dir.join(&filename);

    // ファイルを保存
    fs::write(&save_path, processed_data.clone())
        .map_err(|e| format!("Failed to save processed image: {}", e))?;

    // DBへメタデータ登録
    // 現在のワークスペースDBに接続している前提
    let state: tauri::State<WorkspaceState> = app_handle.state();
    let conn = state
        .lock()
        .map_err(|_| "ワークスペース接続のロックに失敗しました".to_string())?;
    let db = conn.get().map_err(|e| e)?;

    let original_file_name = Path::new(&image_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();

    let metadata = DbImageMetadata {
        id: image_id.clone(),
        original_file_name,
        saved_file_name: filename.clone(),
        image_type: "processed".to_string(),
        created_at: current_timestamp(),
        size: processed_data.len() as i64,
        width: None,
        height: None,
        storage_location: workspace_path.clone(),
        file_path: Some(save_path.to_string_lossy().to_string()),
        is_hidden: 0,
        display_started_at: None,
    };

    db.save_image_metadata(&metadata)
        .map_err(|e| format!("Failed to save image metadata: {}", e))?;

    // イベント発火（ギャラリー等へ反映）
    emit_data_change(
        &app_handle,
        DataChangeEvent::ImageUpserted(crate::events::ImageUpsertedPayload::from(&metadata)),
    )
    .map_err(|e| format!("Failed to emit data change: {}", e))?;

    Ok(save_path.to_string_lossy().to_string())
}

fn generate_random_animation() -> AnimationSettings {
    use rand::Rng;

    let mut rng = rand::thread_rng();

    // 50%の確率で歩くタイプ、50%の確率で飛ぶタイプ
    let is_walk = rng.gen_bool(0.5);

    let animation_type = if is_walk {
        // 歩くタイプの動き
        let walk_types = vec!["normal", "slow", "fast"];
        walk_types[rng.gen_range(0..walk_types.len())].to_string()
    } else {
        // 飛ぶタイプの動き
        let fly_types = vec!["float", "bounce", "rotate", "swim"];
        fly_types[rng.gen_range(0..fly_types.len())].to_string()
    };

    AnimationSettings {
        animation_type,
        speed: rng.gen_range(0.5..=1.5), // 0.5 ~ 1.5
        size: rng.gen_range(0.8..=1.2),  // 0.8 ~ 1.2
    }
}
