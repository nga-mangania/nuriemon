use std::process::{Command, Stdio, ChildStdin, ChildStdout};
use std::io::{Write, BufRead, BufReader};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::fs;
use std::path::Path;
use tauri::{State, Manager, Emitter};

mod db;
mod events;
mod workspace;
mod file_watcher;
mod web_server;
mod websocket;
mod qr_manager;
mod server_state;
use keyring::Entry;
use db::{ImageMetadata, UserSettings, MovementSettings, generate_id, current_timestamp};
use events::{DataChangeEvent, emit_data_change};
use workspace::{WorkspaceState, WorkspaceConnection};
use qr_manager::QrManager;
use server_state::ServerState;

// Python処理の結果
#[derive(Serialize, Deserialize, Clone)]
pub struct ProcessResult {
    pub success: bool,
    pub image: Option<String>,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct ImageProcessingProgress {
    value: u32,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
enum PythonOutput {
    #[serde(rename = "progress")]
    Progress { value: u32 },
    #[serde(rename = "result")]
    Result(ProcessResult),
}


// 常駐Pythonプロセスの状態を管理
struct PythonProcess {
    child: std::process::Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

static PYTHON_PROCESS: Mutex<Option<PythonProcess>> = Mutex::new(None);

fn spawn_python_process() -> Result<PythonProcess, String> {
    // Pythonスクリプトのパスを取得
    let python_script = std::env::current_dir()
        .map_err(|e| e.to_string())?
        .join("../python-sidecar/main.py");

    if !python_script.exists() {
        return Err(format!("Python script not found at: {:?}", python_script));
    }

    let mut child = Command::new("python3")
        .arg(&python_script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start Python process: {}", e))?;

    let stdin = child.stdin.take().ok_or("Failed to get stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
    let reader = BufReader::new(stdout);

    Ok(PythonProcess { child, stdin, stdout: reader })
}

fn ensure_python_process() -> Result<(), String> {
    let mut guard = PYTHON_PROCESS.lock().map_err(|_| "PYTHON_PROCESS lock error".to_string())?;
    let need_spawn = match guard.as_ref() {
        Some(_) => false,
        None => true,
    };
    if need_spawn {
        let proc = spawn_python_process()?;
        *guard = Some(proc);
    }
    Ok(())
}

fn python_send_and_wait(
    app_handle: Option<&tauri::AppHandle>,
    msg: serde_json::Value,
) -> Result<ProcessResult, String> {
    ensure_python_process()?;
    let mut guard = PYTHON_PROCESS.lock().map_err(|_| "PYTHON_PROCESS lock error".to_string())?;
    let proc = guard.as_mut().ok_or("python process not available".to_string())?;

    // 送信
    let line = format!("{}\n", msg.to_string());
    proc.stdin.write_all(line.as_bytes()).map_err(|e| format!("Failed to write to stdin: {}", e))?;
    proc.stdin.flush().ok();

    // 受信（progress/result）
    let reader = &mut proc.stdout;
    let mut final_result: Option<ProcessResult> = None;
    loop {
        let mut buf = String::new();
        let n = reader.read_line(&mut buf).map_err(|e| format!("Failed to read stdout: {}", e))?;
        if n == 0 { break; } // EOF
        let line = buf.trim();
        if line.is_empty() { continue; }
        // base64 を含む行は短縮ログ
        let log_line = if line.contains("data:image") || line.contains("\"image\":") {
            if line.len() > 100 { format!("{}...(rest {})", &line[..100], line.len()-100) } else { line.to_string() }
        } else { line.to_string() };
        println!("[Rust] python <= {}", log_line);

        if let Ok(output) = serde_json::from_str::<PythonOutput>(line) {
            match output {
                PythonOutput::Progress { value } => {
                    if let Some(handle) = app_handle {
                        let _ = handle.emit("image-processing-progress", ImageProcessingProgress { value });
                    }
                }
                PythonOutput::Result(result) => {
                    final_result = Some(result);
                    break;
                }
            }
        }
    }

    match final_result {
        Some(r) => Ok(r),
        None => Err("Failed to get final result from Python process".to_string()),
    }
}

// 非同期応答を待たずに送信だけ行う（warmup等に使用）
fn python_send_nowait(msg: serde_json::Value) -> Result<(), String> {
    ensure_python_process()?;
    let mut guard = PYTHON_PROCESS.lock().map_err(|_| "PYTHON_PROCESS lock error".to_string())?;
    let proc = guard.as_mut().ok_or("python process not available".to_string())?;
    let line = format!("{}\n", msg.to_string());
    proc.stdin.write_all(line.as_bytes()).map_err(|e| format!("Failed to write to stdin: {}", e))?;
    proc.stdin.flush().ok();
    Ok(())
}

// アプリケーション状態管理構造体
pub struct AppState {
    app_handle: tauri::AppHandle,
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// 同期版のprocess_image（内部使用向け）
pub fn process_image_sync(image_data: String) -> Result<ProcessResult, String> {
    let command = serde_json::json!({
        "command": "process",
        "image": image_data,
    });
    python_send_and_wait(None, command)
}

#[tauri::command]
async fn process_image(app_handle: tauri::AppHandle, image_data: String) -> Result<ProcessResult, String> {
    let command = serde_json::json!({
        "command": "process",
        "image": image_data,
    });
    python_send_and_wait(Some(&app_handle), command)
}

// カスタムディレクトリへのファイル操作コマンド
#[tauri::command]
async fn ensure_directory(path: String) -> Result<(), String> {
    let dir_path = Path::new(&path);
    
    if !dir_path.exists() {
        fs::create_dir_all(&dir_path)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    
    Ok(())
}

#[tauri::command]
async fn write_file_absolute(path: String, contents: Vec<u8>) -> Result<(), String> {
    let file_path = Path::new(&path);
    
    // 親ディレクトリが存在しない場合は作成
    if let Some(parent) = file_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directory: {}", e))?;
        }
    }
    
    fs::write(&file_path, contents)
        .map_err(|e| format!("Failed to write file: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn read_file_absolute(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path)
        .map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
async fn file_exists_absolute(path: String) -> Result<bool, String> {
    Ok(Path::new(&path).exists())
}

#[tauri::command]
async fn delete_file_absolute(path: String) -> Result<(), String> {
    let file_path = Path::new(&path);
    
    // ファイルが存在する場合のみ削除
    if file_path.exists() {
        fs::remove_file(&file_path)
            .map_err(|e| format!("Failed to delete file: {}", e))?;
        println!("[delete_file_absolute] deleted path={}", path);
    }
    
    Ok(())
}

// データベース関連のコマンド
#[tauri::command]
async fn save_image_metadata(
    state: State<'_, AppState>,
    workspace: State<'_, WorkspaceState>,
    metadata: ImageMetadata
) -> Result<(), String> {
    let image_id = metadata.id.clone();
    let image_type = metadata.image_type.clone();
    
    let conn = workspace.lock()
        .map_err(|_| "ワークスペース接続のロックに失敗しました".to_string())?;
    let db = conn.get()?;
    
    db.save_image_metadata(&metadata)
        .map_err(|e| format!("Failed to save image metadata: {}", e))?;
    
    // image_typeに応じて適切なイベントを発行
    let event = match image_type.as_str() {
        "bgm" => DataChangeEvent::AudioUpdated { audio_type: "bgm".to_string() },
        "sound_effect" => DataChangeEvent::AudioUpdated { audio_type: "sound_effect".to_string() },
        "background" => DataChangeEvent::BackgroundChanged,
        _ => DataChangeEvent::ImageAdded { id: image_id },
    };
    
    emit_data_change(&state.app_handle, event)?;
    
    Ok(())
}

#[tauri::command]
async fn get_all_images(workspace: State<'_, WorkspaceState>) -> Result<Vec<ImageMetadata>, String> {
    let conn = workspace.lock()
        .map_err(|_| "ワークスペース接続のロックに失敗しました".to_string())?;
    let db = conn.get()?;
    
    db.get_all_images()
        .map_err(|e| format!("Failed to get images: {}", e))
}

#[tauri::command]
async fn delete_image(
    state: State<'_, AppState>,
    workspace: State<'_, WorkspaceState>,
    id: String,
    reason: Option<String>,
) -> Result<(), String> {
    let reason_str = reason.unwrap_or_else(|| "unknown".to_string());
    println!("[delete_image] requested id={} reason={}", id, reason_str);
    let conn = workspace.lock()
        .map_err(|_| "ワークスペース接続のロックに失敗しました".to_string())?;
    let db = conn.get()?;
    
    // 削除前に画像情報を取得してタイプを確認
    let image_type = db.get_image(&id)
        .map_err(|e| format!("Failed to get image: {}", e))?
        .map(|img| img.image_type)
        .unwrap_or_else(|| "unknown".to_string());
    
    // 画像を削除
    db.delete_image(&id)
        .map_err(|e| format!("Failed to delete image: {}", e))?;
    
    // image_typeに応じて適切なイベントを発行
    let event = match image_type.as_str() {
        "bgm" => DataChangeEvent::AudioUpdated { audio_type: "bgm".to_string() },
        "sound_effect" => DataChangeEvent::AudioUpdated { audio_type: "sound_effect".to_string() },
        "background" => DataChangeEvent::BackgroundChanged,
        _ => DataChangeEvent::ImageDeleted { id: id.clone() },
    };
    
    emit_data_change(&state.app_handle, event)?;
    
    Ok(())
}

#[tauri::command]
async fn update_image_file_path(
    workspace: State<'_, WorkspaceState>,
    id: String,
    file_path: String
) -> Result<(), String> {
    let conn = workspace.lock()
        .map_err(|_| "ワークスペース接続のロックに失敗しました".to_string())?;
    let db = conn.get()?;
    
    db.update_image_file_path(&id, &file_path)
        .map_err(|e| format!("Failed to update file path: {}", e))
}

#[tauri::command]
async fn save_user_settings(
    workspace: State<'_, WorkspaceState>,
    settings: UserSettings
) -> Result<(), String> {
    let conn = workspace.lock()
        .map_err(|_| "ワークスペース接続のロックに失敗しました".to_string())?;
    let db = conn.get()?;
    
    db.save_user_settings(&settings)
        .map_err(|e| format!("Failed to save user settings: {}", e))
}

#[tauri::command]
async fn get_user_settings(workspace: State<'_, WorkspaceState>) -> Result<Option<UserSettings>, String> {
    let conn = workspace.lock()
        .map_err(|_| "ワークスペース接続のロックに失敗しました".to_string())?;
    let db = conn.get()?;
    
    db.get_user_settings()
        .map_err(|e| format!("Failed to get user settings: {}", e))
}

#[tauri::command]
async fn get_image_counts(workspace: State<'_, WorkspaceState>) -> Result<(i32, i32), String> {
    let conn = workspace.lock()
        .map_err(|_| "ワークスペース接続のロックに失敗しました".to_string())?;
    let db = conn.get()?;
    
    db.get_image_counts()
        .map_err(|e| format!("Failed to get image counts: {}", e))
}

#[tauri::command]
fn generate_unique_id() -> String {
    generate_id()
}

#[tauri::command]
fn get_current_timestamp() -> String {
    current_timestamp()
}

// データベース操作: 動き設定の保存
#[tauri::command]
fn save_movement_settings(
    state: State<AppState>,
    workspace: State<WorkspaceState>,
    settings: MovementSettings
) -> Result<(), String> {
    let image_id = settings.image_id.clone();
    
    let conn = workspace.lock()
        .map_err(|_| "ワークスペース接続のロックに失敗しました".to_string())?;
    let db = conn.get()?;
    
    db.save_movement_settings(&settings)
        .map_err(|e| format!("Failed to save movement settings: {}", e))?;
    
    // イベントを発行
    emit_data_change(&state.app_handle, DataChangeEvent::AnimationSettingsChanged { image_id })?;
    
    Ok(())
}

// データベース操作: 動き設定の取得
#[tauri::command]
fn get_movement_settings(workspace: State<WorkspaceState>, image_id: String) -> Result<Option<MovementSettings>, String> {
    let conn = workspace.lock()
        .map_err(|_| "ワークスペース接続のロックに失敗しました".to_string())?;
    let db = conn.get()?;
    db.get_movement_settings(&image_id)
        .map_err(|e| format!("Failed to get movement settings: {}", e))
}

// データベース操作: すべての動き設定の取得
#[tauri::command]
fn get_all_movement_settings(workspace: State<WorkspaceState>) -> Result<Vec<MovementSettings>, String> {
    let conn = workspace.lock()
        .map_err(|_| "ワークスペース接続のロックに失敗しました".to_string())?;
    let db = conn.get()?;
    
    db.get_all_movement_settings()
        .map_err(|e| format!("Failed to get all movement settings: {}", e))
}

// アプリケーション設定の保存
#[tauri::command]
fn save_app_setting(
    state: State<AppState>,
    workspace: State<WorkspaceState>,
    key: String,
    value: String
) -> Result<(), String> {
    let conn = workspace.lock()
        .map_err(|_| "ワークスペース接続のロックに失敗しました".to_string())?;
    let db = conn.get()?;
    
    db.save_app_setting(&key, &value)
        .map_err(|e| format!("Failed to save app setting: {}", e))?;
    
    // 特定の設定項目の場合、専用のイベントを発行
    let event = match key.as_str() {
        "ground_position" => {
            if let Ok(position) = value.parse::<i32>() {
                DataChangeEvent::GroundPositionChanged { position }
            } else {
                DataChangeEvent::AppSettingChanged { key, value }
            }
        },
        "deletion_time" => DataChangeEvent::DeletionTimeChanged { time: value.clone() },
        _ => DataChangeEvent::AppSettingChanged { key, value },
    };
    
    emit_data_change(&state.app_handle, event)?;
    
    Ok(())
}

// アプリケーション設定の取得
#[tauri::command]
fn get_app_setting(workspace: State<WorkspaceState>, key: String) -> Result<Option<String>, String> {
    let conn = workspace.lock()
        .map_err(|_| "ワークスペース接続のロックに失敗しました".to_string())?;
    let db = conn.get()?;
    
    db.get_app_setting(&key)
        .map_err(|e| format!("Failed to get app setting: {}", e))
}

// 複数のアプリケーション設定の取得
#[tauri::command]
fn get_app_settings(workspace: State<WorkspaceState>, keys: Vec<String>) -> Result<std::collections::HashMap<String, String>, String> {
    let conn = workspace.lock()
        .map_err(|_| "ワークスペース接続のロックに失敗しました".to_string())?;
    let db = conn.get()?;
    let keys_refs: Vec<&str> = keys.iter().map(|s| s.as_str()).collect();
    db.get_app_settings(&keys_refs)
        .map_err(|e| format!("Failed to get app settings: {}", e))
}

// フォルダ監視の開始
#[tauri::command]
fn start_folder_watching(
    state: State<AppState>,
    workspace: State<WorkspaceState>,
    watch_path: String
) -> Result<(), String> {
    // 現在のワークスペースパスを取得（絶対パス）
    let conn = workspace.lock()
        .map_err(|_| "ワークスペース接続のロックに失敗しました".to_string())?;
    
    println!("[Rust] start_folder_watching - current_path: {:?}", conn.current_path);
    
    let workspace_path = conn.current_path.as_ref()
        .ok_or("ワークスペースが選択されていません".to_string())?
        .parent()  // .nuriemonディレクトリの親を取得
        .and_then(|p| p.parent())  // nuriemon.dbの親の親
        .ok_or("ワークスペースパスの取得に失敗しました".to_string())?
        .to_string_lossy()
        .to_string();
    
    println!("[Rust] start_folder_watching - watch_path: {}", watch_path);
    println!("[Rust] start_folder_watching - workspace_path: {}", workspace_path);
    
    file_watcher::start_folder_watching(
        state.app_handle.clone(),
        watch_path,
        workspace_path
    )
}

// フォルダ監視の停止
#[tauri::command]
fn stop_folder_watching() -> Result<(), String> {
    file_watcher::stop_folder_watching();
    Ok(())
}

// Webサーバーの起動
#[tauri::command]
async fn start_web_server(
    state: State<'_, AppState>,
    server_state: State<'_, ServerState>,
) -> Result<u16, String> {
    // すでに起動済みの場合はポート番号を返す
    if let Some(port) = server_state.get_server_port() {
        return Ok(port);
    }

    // 起動中フラグで同時起動を防止
    if !server_state.begin_starting() {
        // 先行の起動完了を少し待ってから再取得
        for _ in 0..30 {
            if let Some(port) = server_state.get_server_port() {
                return Ok(port);
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        // まだ未設定ならエラーで返す
        return Err("Webサーバー起動中です。少し待って再試行してください".to_string());
    }

    // Webサーバーを起動
    let result = web_server::start_web_server(state.app_handle.clone()).await;

    match result {
        Ok(port) => {
            // QRマネージャーを初期化
            let qr_manager = Arc::new(QrManager::new(port));
            server_state.set_qr_manager(qr_manager);
            // ポート番号を保存
            server_state.set_server_port(port);
            server_state.finish_starting();
            Ok(port)
        }
        Err(e) => {
            server_state.finish_starting();
            Err(format!("Webサーバーの起動に失敗しました: {}", e))
        }
    }
}

// QRコードの生成
#[tauri::command]
fn generate_qr_code(
    image_id: String,
    server_state: State<'_, ServerState>,
) -> Result<serde_json::Value, String> {
    let qr_manager = server_state.get_qr_manager()
        .ok_or("Webサーバーが起動していません".to_string())?;
    
    let (session_id, qr_code) = qr_manager.create_session(&image_id);
    
    Ok(serde_json::json!({
        "sessionId": session_id,
        "qrCode": qr_code,
        "imageId": image_id
    }))
}

// QRコードセッションの状態を取得
#[tauri::command]
fn get_qr_session_status(
    session_id: String,
    server_state: State<'_, ServerState>,
) -> Result<serde_json::Value, String> {
    let qr_manager = server_state.get_qr_manager()
        .ok_or("Webサーバーが起動していません".to_string())?;
    
    if let Some((connected, remaining)) = qr_manager.get_session_status(&session_id) {
        Ok(serde_json::json!({
            "connected": connected,
            "remainingSeconds": remaining.as_secs()
        }))
    } else {
        Err("セッションが見つかりません".to_string())
    }
}

// 任意文字列からQRコード（data URI）を生成（Relay用のURL等）
#[tauri::command]
fn generate_qr_from_text(text: String) -> Result<String, String> {
    use qrcode::{QrCode, Color};
    use base64::{engine::general_purpose, Engine as _};

    let code = QrCode::new(text).map_err(|e| format!("QR_ENCODE_ERROR: {}", e))?;
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
    let encoded = general_purpose::STANDARD.encode(svg);
    Ok(format!("data:image/svg+xml;base64,{}", encoded))
}

// QRコード表示ウィンドウを開く
#[tauri::command]
async fn open_animation_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::webview::WebviewWindowBuilder;
    use tauri::WebviewUrl;
    
    // すでにウィンドウが存在する場合は前面に表示
    if let Some(window) = app.get_webview_window("animation") {
        window.show().map_err(|e| format!("ウィンドウの表示に失敗しました: {}", e))?;
        window.set_focus().map_err(|e| format!("ウィンドウのフォーカスに失敗しました: {}", e))?;
        return Ok(());
    }
    
    // 新しいウィンドウを作成
    let window = WebviewWindowBuilder::new(&app, "animation", WebviewUrl::App("#/animation".into()))
        .inner_size(1024.0, 768.0)
        .title("ぬりえもん - アニメーション")
        .resizable(true)
        .build()
        .map_err(|e| format!("アニメーションウィンドウの作成に失敗しました: {}", e))?;
    
    // 開発ビルドでは自動でDevToolsを開く（検証を容易に）
    #[cfg(debug_assertions)]
    {
        window.open_devtools();
    }
    
    Ok(())
}

#[tauri::command]
async fn open_qr_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::webview::WebviewWindowBuilder;
    use tauri::WebviewUrl;
    
    // すでにウィンドウが存在する場合は前面に表示
    if let Some(window) = app.get_webview_window("qr-display") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    
    // 新しいウィンドウを作成
    let _window = WebviewWindowBuilder::new(
        &app,
        "qr-display",
        WebviewUrl::App("qr-display.html".into())
    )
    .title("QRコード - ぬりえもん")
    .inner_size(600.0, 700.0)
    .resizable(true)
    .build()
    .map_err(|e| format!("ウィンドウの作成に失敗しました: {}", e))?;
    
    // 開発モードでも自動でDevToolsは開かない（パフォーマンス配慮）
    
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(move |app| {
            // アプリケーション状態の初期化
            let app_state = AppState {
                app_handle: app.handle().clone(),
            };
            
            // ワークスペース接続の初期化
            let workspace_connection = WorkspaceState::new(WorkspaceConnection::new());
            
            // サーバー状態の初期化
            let server_state = ServerState::new();
            
            app.manage(app_state);
            app.manage(workspace_connection);
            app.manage(server_state);
            // Dev build: auto-open DevTools for main window, to ease debugging
            #[cfg(debug_assertions)]
            if let Some(win) = app.get_webview_window("main") {
                win.open_devtools();
            }
            
            // デバッグビルドでもDevToolsの自動オープンは無効化
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet, 
            process_image,
            warmup_python,
            ensure_directory,
            write_file_absolute,
            read_file_absolute,
            file_exists_absolute,
            delete_file_absolute,
            save_image_metadata,
            get_all_images,
            delete_image,
            update_image_file_path,
            save_user_settings,
            get_user_settings,
            get_image_counts,
            generate_unique_id,
            get_current_timestamp,
            save_movement_settings,
            get_movement_settings,
            get_all_movement_settings,
            save_app_setting,
            get_app_setting,
            get_app_settings,
            // ワークスペース関連
            workspace::initialize_workspace_db,
            workspace::connect_workspace_db,
            workspace::close_workspace_db,
            workspace::save_global_setting,
            workspace::get_global_setting,
            // フォルダ監視
            start_folder_watching,
            stop_folder_watching,
            // Webサーバーとスマホ連携
            start_web_server,
            generate_qr_code,
            generate_qr_from_text,
            get_qr_session_status,
            open_qr_window,
            open_animation_window
            ,save_event_secret
            ,load_event_secret
            ,delete_event_secret
            ,open_devtools
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// set_no_delete_mode / get_no_delete_mode は廃止

// Pythonウォームアップ
#[tauri::command]
fn warmup_python() -> Result<(), String> {
    // 起動してhealth/warmupを送る（エラーは返す）
    ensure_python_process()?;
    // 応答は待たずに即時戻す（レンダラをブロックしない）
    python_send_nowait(serde_json::json!({"command":"warmup"}))?;
    Ok(())
}

// ================== Secure Secrets (OS Keychain) ==================

fn keychain_account(env: &str) -> (String, String) {
    let service = "nuriemon".to_string();
    let account = format!("event_setup_secret:{}", env);
    (service, account)
}

#[tauri::command]
fn save_event_secret(env: String, secret: String) -> Result<(), String> {
    let (service, account) = keychain_account(env.trim());
    Entry::new(&service, &account)
        .map_err(|e| format!("KEYCHAIN_INIT_ERROR: {}", e))?
        .set_password(&secret)
        .map_err(|e| format!("KEYCHAIN_WRITE_ERROR: {}", e))
}

#[tauri::command]
fn load_event_secret(env: String) -> Result<Option<String>, String> {
    let (service, account) = keychain_account(env.trim());
    let entry = Entry::new(&service, &account).map_err(|e| format!("KEYCHAIN_INIT_ERROR: {}", e))?;
    match entry.get_password() {
        Ok(pw) => Ok(Some(pw)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("KEYCHAIN_READ_ERROR: {}", e)),
    }
}

#[tauri::command]
fn delete_event_secret(env: String) -> Result<(), String> {
    let (service, account) = keychain_account(env.trim());
    let entry = Entry::new(&service, &account).map_err(|e| format!("KEYCHAIN_INIT_ERROR: {}", e))?;
    match entry.delete_password() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("KEYCHAIN_DELETE_ERROR: {}", e)),
    }
}

// 開発用: 指定ウィンドウのDevToolsを開く
#[tauri::command]
fn open_devtools(window_label: Option<String>, app: tauri::AppHandle) -> Result<(), String> {
    let label = window_label.unwrap_or_else(|| "qr-display".to_string());
    if let Some(win) = app.get_webview_window(&label) {
        #[cfg(debug_assertions)]
        {
            win.open_devtools();
            return Ok(());
        }
        #[cfg(not(debug_assertions))]
        {
            return Err("DevTools disabled in release build".into());
        }
    }
    Err(format!("window not found: {}", label))
}
