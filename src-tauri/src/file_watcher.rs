use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::thread;
use tauri::{AppHandle, Emitter};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use std::fs;
use base64::{Engine as _, engine::general_purpose};

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
    pub position_x: f32,
    pub position_y: f32,
    pub size: f32,
}

pub fn start_folder_watching(
    app_handle: AppHandle,
    watch_path: String,
    workspace_id: String,
) -> Result<(), String> {
    if !Path::new(&watch_path).exists() {
        return Err("指定されたフォルダが存在しません".to_string());
    }

    let app_handle_clone = app_handle.clone();
    
    thread::spawn(move || {
        let (tx, rx) = channel();
        
        let mut watcher = RecommendedWatcher::new(tx, Config::default())
            .expect("Failed to create watcher");
        
        watcher.watch(Path::new(&watch_path), RecursiveMode::NonRecursive)
            .expect("Failed to watch path");
        
        println!("Watching folder: {}", watch_path);
        
        for res in rx {
            match res {
                Ok(event) => {
                    if let EventKind::Create(_) = event.kind {
                        for path in event.paths {
                            if is_image_file(&path) {
                                println!("New image detected: {:?}", path);
                                
                                let result = process_new_image(
                                    app_handle_clone.clone(),
                                    path.clone(),
                                    workspace_id.clone(),
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
            }
        }
    });
    
    Ok(())
}

fn is_image_file(path: &Path) -> bool {
    if let Some(extension) = path.extension() {
        let ext = extension.to_str().unwrap_or("").to_lowercase();
        matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "gif" | "bmp" | "webp")
    } else {
        false
    }
}

fn process_new_image(
    app_handle: AppHandle,
    image_path: PathBuf,
    workspace_id: String,
) -> Result<(), String> {
    // 画像IDを生成
    let image_id = Uuid::new_v4().to_string();
    let original_path = image_path.to_string_lossy().to_string();
    
    // 処理開始を通知
    app_handle.emit("auto-import-started", AutoImportStarted {
        image_id: image_id.clone(),
        original_path: original_path.clone(),
    }).map_err(|e| format!("Failed to emit start event: {}", e))?;
    
    // 画像処理を実行
    let handle_clone = app_handle.clone();
    let image_id_clone = image_id.clone();
    let workspace_id_clone = workspace_id.clone();
    
    thread::spawn(move || {
        match process_image_async(handle_clone.clone(), image_path, image_id_clone.clone(), workspace_id_clone) {
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
                let _ = handle_clone.emit("auto-import-error", AutoImportError {
                    image_id: image_id_clone,
                    error: e,
                });
            }
        }
    });
    
    Ok(())
}

fn process_image_async(
    _app_handle: AppHandle,
    image_path: PathBuf,
    image_id: String,
    workspace_id: String,
) -> Result<String, String> {
    // 画像ファイルを読み込み
    let image_data = fs::read(&image_path)
        .map_err(|e| format!("Failed to read image file: {}", e))?;
    
    // Base64エンコード
    let base64_data = general_purpose::STANDARD.encode(&image_data);
    
    // ファイル拡張子を取得
    let extension = image_path.extension()
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
    let processed_data_url = result.image
        .ok_or("No processed image returned")?;
    
    // データURLからBase64部分を抽出
    let base64_start = processed_data_url.find("base64,")
        .ok_or("Invalid data URL format")?;
    let base64_str = &processed_data_url[base64_start + 7..];
    
    // Base64をデコード
    let processed_data = general_purpose::STANDARD.decode(base64_str)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;
    
    // 保存先パスを生成（ワークスペースは既にフルパスなので、そのまま使用）
    let workspace_path = PathBuf::from(&workspace_id);
    let processed_dir = workspace_path.join("images").join("processed");
    
    // ディレクトリを作成
    fs::create_dir_all(&processed_dir)
        .map_err(|e| format!("Failed to create directory: {}", e))?;
    
    // ファイル名を生成
    let filename = format!("{}.png", image_id);
    let save_path = processed_dir.join(&filename);
    
    // ファイルを保存
    fs::write(&save_path, processed_data)
        .map_err(|e| format!("Failed to save processed image: {}", e))?;
    
    Ok(save_path.to_string_lossy().to_string())
}

fn generate_random_animation() -> AnimationSettings {
    use std::time::{SystemTime, UNIX_EPOCH};
    
    // 簡易的な乱数生成（実際はrandクレートを使用すべき）
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u32;
    
    let animation_types = vec!["float", "bounce", "rotate", "swim"];
    let animation_type = animation_types[seed as usize % animation_types.len()].to_string();
    
    AnimationSettings {
        animation_type,
        speed: 0.5 + (seed % 100) as f32 / 100.0, // 0.5 ~ 1.5
        position_x: (seed % 80) as f32 + 10.0, // 10 ~ 90
        position_y: (seed % 60) as f32 + 20.0, // 20 ~ 80
        size: 0.8 + (seed % 40) as f32 / 100.0, // 0.8 ~ 1.2
    }
}