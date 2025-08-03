use std::process::{Command, Stdio};
use std::io::{Write, BufRead, BufReader};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::fs;
use std::path::Path;
use tauri::{State, Manager, Emitter};

mod db;
mod events;
mod workspace;
mod file_watcher;
use db::{ImageMetadata, UserSettings, MovementSettings, generate_id, current_timestamp};
use events::{DataChangeEvent, emit_data_change};
use workspace::{WorkspaceState, WorkspaceConnection};

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


// Pythonプロセスの状態を管理
// TODO: 将来的にPythonプロセスを永続化して起動時間を短縮する
#[allow(dead_code)]  // 将来の使用のために保持
struct PythonProcess {
    child: Option<std::process::Child>,
}

// グローバルなPythonプロセス
// TODO: アプリ起動時に一度だけPythonプロセスを起動し、使い回すことで
// モデルの読み込み時間を削減し、連続処理を高速化する
#[allow(dead_code)]  // 将来の使用のために保持
static PYTHON_PROCESS: Mutex<Option<PythonProcess>> = Mutex::new(None);

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
    use std::process::{Command, Stdio};
    use std::io::{Write, BufRead, BufReader};
    
    // Pythonスクリプトのパスを取得
    let python_script = std::env::current_dir()
        .map_err(|e| e.to_string())?
        .join("../python-sidecar/main.py");
    
    println!("[Rust] Python script path: {:?}", python_script);
    
    // スクリプトが存在するか確認
    if !python_script.exists() {
        return Err(format!("Python script not found at: {:?}", python_script));
    }
    
    // Pythonコマンドを実行
    let mut child = Command::new("python3")
        .arg(&python_script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start Python process: {}", e))?;
    
    // 標準入力に画像データを送信
    let stdin = child.stdin.as_mut()
        .ok_or("Failed to get stdin")?;
    
    let command = serde_json::json!({
        "command": "process",
        "image": image_data
    });
    
    writeln!(stdin, "{}", command.to_string())
        .map_err(|e| format!("Failed to write to stdin: {}", e))?;
    
    // 結果を読み取る
    let stdout = child.stdout.as_mut()
        .ok_or("Failed to get stdout")?;
    let reader = BufReader::new(stdout);
    
    let mut final_result: Option<ProcessResult> = None;

    for line in reader.lines() {
        if let Ok(line) = line {
            if let Ok(output) = serde_json::from_str::<PythonOutput>(&line) {
                match output {
                    PythonOutput::Progress { value } => {
                        println!("[Rust] Progress: {}", value);
                    },
                    PythonOutput::Result(result) => {
                        println!("[Rust] Result received: success={}", result.success);
                        final_result = Some(result);
                        break;
                    }
                }
            }
        }
    }
    
    // プロセスが正常に終了するのを待つ
    let status = child.wait().map_err(|e| format!("Failed to wait on child: {}", e))?;
    if !status.success() {
        let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;
        let err_reader = BufReader::new(stderr);
        let err_lines: Vec<String> = err_reader.lines().filter_map(Result::ok).collect();
        return Err(format!("Python process exited with error: {}", err_lines.join("\n")));
    }
    
    match final_result {
        Some(result) => Ok(result),
        None => Err("Failed to get final result from Python process".to_string()),
    }
}

#[tauri::command]
async fn process_image(app_handle: tauri::AppHandle, image_data: String) -> Result<ProcessResult, String> {
    // Pythonスクリプトのパスを取得
    let python_script = std::env::current_dir()
        .map_err(|e| e.to_string())?
        .join("../python-sidecar/main.py");
    
    println!("[Rust] Python script path: {:?}", python_script);
    
    // スクリプトが存在するか確認
    if !python_script.exists() {
        return Err(format!("Python script not found at: {:?}", python_script));
    }
    
    // Pythonコマンドを実行
    let mut child = Command::new("python3")
        .arg(&python_script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start Python process: {}", e))?;
    
    // 標準入力に画像データを送信
    let stdin = child.stdin.as_mut()
        .ok_or("Failed to get stdin")?;
    
    let command = serde_json::json!({
        "command": "process",
        "image": image_data
    });
    
    writeln!(stdin, "{}", command.to_string())
        .map_err(|e| format!("Failed to write to stdin: {}", e))?;
    
    // 結果を読み取る
    let stdout = child.stdout.as_mut()
        .ok_or("Failed to get stdout")?;
    let reader = BufReader::new(stdout);
    
    let mut final_result: Option<ProcessResult> = None;

    for line in reader.lines() {
        if let Ok(line) = line {
            // base64データを含む行は短縮して表示
            let log_line = if line.contains("data:image") || line.contains("\"image\":") {
                let preview = if line.len() > 100 {
                    format!("{}...(残り{}文字)", &line[..100], line.len() - 100)
                } else {
                    line.clone()
                };
                preview
            } else {
                line.clone()
            };
            println!("[Rust] Received from Python: {}", log_line);
            if let Ok(output) = serde_json::from_str::<PythonOutput>(&line) {
                match output {
                    PythonOutput::Progress { value } => {
                        println!("[Rust] Progress: {}", value);
                        app_handle.emit("image-processing-progress", ImageProcessingProgress { value }).unwrap();
                    },
                    PythonOutput::Result(result) => {
                        println!("[Rust] Result received: success={}", result.success);
                        final_result = Some(result);
                        break; // 結果を受け取ったらループを抜ける
                    }
                }
            } else {
                println!("[Rust] Failed to parse Python output: {}", line);
            }
        }
    }
    
    // プロセスが正常に終了するのを待つ
    let status = child.wait().map_err(|e| format!("Failed to wait on child: {}", e))?;
    if !status.success() {
        // エラーストリームを読み取る
        let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;
        let err_reader = BufReader::new(stderr);
        let err_lines: Vec<String> = err_reader.lines().filter_map(Result::ok).collect();
        println!("[Rust] Python process stderr: {}", err_lines.join("\n"));
        return Err(format!("Python process exited with error: {}", err_lines.join("\n")));
    }

    // 結果が取得できた場合、プロセスを強制終了
    if final_result.is_some() {
        let _ = child.kill();
    }
    
    match final_result {
        Some(result) => {
            println!("[Rust] Returning result to frontend");
            Ok(result)
        },
        None => Err("Failed to get final result from Python process".to_string()),
    }
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
    id: String
) -> Result<(), String> {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(move |app| {
            // アプリケーション状態の初期化
            let app_state = AppState {
                app_handle: app.handle().clone(),
            };
            
            // ワークスペース接続の初期化
            let workspace_connection = WorkspaceState::new(WorkspaceConnection::new());
            
            app.manage(app_state);
            app.manage(workspace_connection);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet, 
            process_image,
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
            stop_folder_watching
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
