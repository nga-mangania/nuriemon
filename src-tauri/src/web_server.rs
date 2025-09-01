use actix_web::{web, App, HttpResponse, HttpServer, Error, middleware, HttpRequest};
use actix_web::http::header;
use rust_embed::RustEmbed;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use local_ip_address::local_ip;
use std::path::{Path, PathBuf};

use crate::workspace::WorkspaceState;

#[derive(RustEmbed)]
#[folder = "../mobile-ui/dist"]
struct MobileAssets;

pub struct WebServerState {
    pub app_handle: Arc<AppHandle>,
    pub port: u16,
}

pub async fn start_web_server(app_handle: AppHandle) -> Result<u16, Box<dyn std::error::Error + Send + Sync>> {
    let app_handle = Arc::new(app_handle);
    
    // ポートを自動選択（8080-8090の範囲で利用可能なポートを探す）
    let mut last_error = None;
    
    for port in 8080..=8090 {
        let app_handle_clone = app_handle.clone();
        
        let server = HttpServer::new(move || {
            let state = WebServerState {
                app_handle: app_handle_clone.clone(),
                port,
            };
            
            App::new()
                .app_data(web::Data::new(state))
                .wrap(middleware::Logger::default())
                .service(web::resource("/").route(web::get().to(serve_index)))
                .service(web::resource("/mobile").route(web::get().to(serve_mobile)))
                .service(web::resource("/image/{id}").route(web::get().to(serve_image_by_id)))
                .service(web::resource("/api/connect").route(web::post().to(handle_connect)))
                .service(web::resource("/ws").route(web::get().to(crate::websocket::websocket_handler)))
                .default_service(web::route().to(serve_static))
        })
        .bind(("0.0.0.0", port));
        
        match server {
            Ok(server) => {
                println!("Webサーバーを起動しました: http://{}:{}", local_ip()?, port);
                
                // Tauriのランタイム上でサーバーを起動
                let server_handle = server.run();
                tauri::async_runtime::spawn(server_handle);
                
                return Ok(port);
            }
            Err(e) => {
                last_error = Some(e);
                continue;
            }
        }
    }
    
    Err(format!("利用可能なポートが見つかりません: {:?}", last_error).into())
}

async fn serve_index(req: HttpRequest) -> Result<HttpResponse, Error> {
    println!("[web_server] GET / from {:?}", req.peer_addr());
    serve_embedded_file("index.html")
}

async fn serve_mobile(req: HttpRequest) -> Result<HttpResponse, Error> {
    println!("[web_server] GET /mobile from {:?}", req.peer_addr());
    serve_embedded_file("mobile.html")
}

async fn serve_static(req: HttpRequest, path: web::Path<String>) -> Result<HttpResponse, Error> {
    println!("[web_server] GET /{} from {:?}", path, req.peer_addr());
    serve_embedded_file(&path.into_inner())
}

fn serve_embedded_file(path: &str) -> Result<HttpResponse, Error> {
    let path = path.trim_start_matches('/');
    
    // プレフィックス有無の両方を試す（後方互換）
    let asset = MobileAssets::get(path).or_else(|| MobileAssets::get(&format!("/{}", path)));

    match asset {
        Some(content) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            let body = content.data.into_owned();
            // HTMLは文字化け回避のためUTF-8を明示
            if mime.type_() == mime::TEXT && mime.subtype() == mime::HTML {
                Ok(HttpResponse::Ok()
                    .insert_header((header::CONTENT_TYPE, "text/html; charset=utf-8"))
                    .body(body))
            } else {
                Ok(HttpResponse::Ok()
                    .content_type(mime.to_string())
                    .body(body))
            }
        }
        None => Ok(HttpResponse::NotFound()
            .insert_header((header::CONTENT_TYPE, "text/plain; charset=utf-8"))
            .body("ファイルが見つかりません")),
    }
}

// 画像IDからローカルファイルを配信
async fn serve_image_by_id(
    data: web::Data<WebServerState>,
    path: web::Path<String>,
) -> Result<HttpResponse, Error> {
    let image_id = path.into_inner();
    println!("[web_server] GET /image/{}", image_id);

    // ワークスペースDBにアクセスしてメタデータを取得
    let state: tauri::State<WorkspaceState> = data.app_handle.state();
    let conn = state
        .lock()
        .map_err(|_| actix_web::error::ErrorInternalServerError("ワークスペース接続のロックに失敗"))?;
    let db = conn
        .get()
        .map_err(|e| actix_web::error::ErrorInternalServerError(e))?;

    let meta = db
        .get_image(&image_id)
        .map_err(|e| actix_web::error::ErrorInternalServerError(e))?;

    let Some(meta) = meta else {
        return Ok(HttpResponse::NotFound().body("画像が見つかりません"));
    };

    // ファイルパスを決定
    let file_path: PathBuf = if let Some(fp) = meta.file_path.clone() {
        PathBuf::from(fp)
    } else {
        // 互換のため保存先とタイプから推測
        let base = PathBuf::from(meta.storage_location.clone());
        let subdir = match meta.image_type.as_str() {
            "processed" => Path::new("images").join("processed"),
            "original" => Path::new("images").join("originals"),
            "background" => Path::new("images").join("backgrounds"),
            "bgm" | "sound_effect" | "soundEffect" => Path::new("audio").to_path_buf(),
            _ => Path::new("images").join("processed"),
        };
        base.join(subdir).join(meta.saved_file_name.clone())
    };

    // 読み込み
    let bytes = match std::fs::read(&file_path) {
        Ok(b) => b,
        Err(_) => return Ok(HttpResponse::NotFound().body("ファイルを読み込めませんでした")),
    };

    // MIMEタイプ推定
    let mime = mime_guess::from_path(&file_path).first_or_octet_stream();
    Ok(HttpResponse::Ok()
        .content_type(mime.to_string())
        .body(bytes))
}

async fn handle_connect(
    data: web::Data<WebServerState>,
    body: web::Json<serde_json::Value>,
) -> Result<HttpResponse, Error> {
    println!("[web_server] POST /api/connect body={}", body);
    // 接続リクエストの処理
    let session_id = body.get("sessionId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| actix_web::error::ErrorBadRequest("sessionIdが必要です"))?;
    
    let image_id = body.get("imageId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| actix_web::error::ErrorBadRequest("imageIdが必要です"))?;

    // Tauriイベントを発行して接続を通知
    data.app_handle.emit("mobile-connected", serde_json::json!({
        "sessionId": session_id,
        "imageId": image_id,
    })).map_err(|e| actix_web::error::ErrorInternalServerError(e))?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "接続されました"
    })))
}
