use std::process::{Command, Stdio};
use std::io::{Write, BufRead, BufReader};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::fs;
use std::path::Path;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            greet, 
            process_image,
            ensure_directory,
            write_file_absolute,
            read_file_absolute,
            file_exists_absolute
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
