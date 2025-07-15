use std::process::{Command, Stdio};
use std::io::{Write, BufRead, BufReader};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

mod db;
use db::{Database, ImageMetadata, UserSettings, MovementSettings, generate_id, current_timestamp};

// Python処理の結果
#[derive(Serialize, Deserialize)]
struct ProcessResult {
    success: bool,
    image: Option<String>,
    error: Option<String>,
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

// データベース管理構造体
pub struct AppState {
    db: Mutex<Database>,
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn process_image(image_data: String) -> Result<ProcessResult, String> {
    // Pythonスクリプトのパスを取得
    let python_script = std::env::current_dir()
        .map_err(|e| e.to_string())?
        .join("../python-sidecar/main.py");
    
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
    
    for line in reader.lines() {
        if let Ok(line) = line {
            if let Ok(result) = serde_json::from_str::<ProcessResult>(&line) {
                // プロセスを終了
                let _ = child.kill();
                return Ok(result);
            }
        }
    }
    
    // プロセスを終了
    let _ = child.kill();
    Err("Failed to get result from Python process".to_string())
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

// データベース関連のコマンド
#[tauri::command]
async fn save_image_metadata(
    state: State<'_, AppState>,
    metadata: ImageMetadata
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.save_image_metadata(&metadata)
        .map_err(|e| format!("Failed to save image metadata: {}", e))
}

#[tauri::command]
async fn get_all_images(state: State<'_, AppState>) -> Result<Vec<ImageMetadata>, String> {
    let db = state.db.lock().unwrap();
    db.get_all_images()
        .map_err(|e| format!("Failed to get images: {}", e))
}

#[tauri::command]
async fn delete_image(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.delete_image(&id)
        .map_err(|e| format!("Failed to delete image: {}", e))
}

#[tauri::command]
async fn save_user_settings(
    state: State<'_, AppState>,
    settings: UserSettings
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.save_user_settings(&settings)
        .map_err(|e| format!("Failed to save user settings: {}", e))
}

#[tauri::command]
async fn get_user_settings(state: State<'_, AppState>) -> Result<Option<UserSettings>, String> {
    let db = state.db.lock().unwrap();
    db.get_user_settings()
        .map_err(|e| format!("Failed to get user settings: {}", e))
}

#[tauri::command]
async fn get_image_counts(state: State<'_, AppState>) -> Result<(i32, i32), String> {
    let db = state.db.lock().unwrap();
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
fn save_movement_settings(state: State<AppState>, settings: MovementSettings) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.save_movement_settings(&settings)
        .map_err(|e| format!("Failed to save movement settings: {}", e))
}

// データベース操作: 動き設定の取得
#[tauri::command]
fn get_movement_settings(state: State<AppState>, image_id: String) -> Result<Option<MovementSettings>, String> {
    let db = state.db.lock().unwrap();
    db.get_movement_settings(&image_id)
        .map_err(|e| format!("Failed to get movement settings: {}", e))
}

// データベース操作: すべての動き設定の取得
#[tauri::command]
fn get_all_movement_settings(state: State<AppState>) -> Result<Vec<MovementSettings>, String> {
    let db = state.db.lock().unwrap();
    db.get_all_movement_settings()
        .map_err(|e| format!("Failed to get all movement settings: {}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // データベースパスの設定
    // Tauri v2では、アプリデータディレクトリはアプリ初期化後に取得する必要がある
    let home_dir = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    let app_dir = PathBuf::from(home_dir).join(".nuriemon");
    let db_path = app_dir.join("nuriemon.db");
    
    // データベースディレクトリの作成
    if let Some(parent) = db_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    
    // データベースの初期化
    let database = Database::new(db_path)
        .expect("Failed to create database");
    database.initialize()
        .expect("Failed to initialize database");
    
    let app_state = AppState {
        db: Mutex::new(database),
    };
    
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            greet, 
            process_image,
            ensure_directory,
            write_file_absolute,
            read_file_absolute,
            file_exists_absolute,
            save_image_metadata,
            get_all_images,
            delete_image,
            save_user_settings,
            get_user_settings,
            get_image_counts,
            generate_unique_id,
            get_current_timestamp,
            save_movement_settings,
            get_movement_settings,
            get_all_movement_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
