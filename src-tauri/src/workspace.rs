use crate::db::Database;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};

/// ワークスペースのDB接続を管理する構造体
pub struct WorkspaceConnection {
    pub connection: Option<Database>,
    pub current_path: Option<PathBuf>,
}

impl WorkspaceConnection {
    pub fn new() -> Self {
        Self {
            connection: None,
            current_path: None,
        }
    }

    /// ワークスペースDBに接続
    pub fn connect(&mut self, db_path: PathBuf) -> Result<(), String> {
        // 既存の接続をクローズ
        self.close();

        // 新しい接続を作成
        let db =
            Database::new(db_path.clone()).map_err(|e| format!("データベース接続エラー: {}", e))?;

        // テーブルを初期化
        db.initialize()
            .map_err(|e| format!("データベース初期化エラー: {}", e))?;

        self.connection = Some(db);
        self.current_path = Some(db_path);

        Ok(())
    }

    /// 接続をクローズ
    pub fn close(&mut self) {
        self.connection = None;
        self.current_path = None;
    }

    /// 現在の接続を取得
    pub fn get(&self) -> Result<&Database, String> {
        self.connection
            .as_ref()
            .ok_or_else(|| "データベースに接続されていません".to_string())
    }
}

pub type WorkspaceState = Mutex<WorkspaceConnection>;

/// 新しいワークスペースDBを初期化
#[tauri::command]
pub async fn initialize_workspace_db(db_path: String) -> Result<(), String> {
    let path = PathBuf::from(&db_path);

    // 親ディレクトリが存在することを確認
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("ディレクトリ作成エラー: {}", e))?;
        }
    }

    // DBファイルを作成して初期化
    let db = Database::new(path).map_err(|e| format!("データベース作成エラー: {}", e))?;

    db.initialize()
        .map_err(|e| format!("データベース初期化エラー: {}", e))?;

    Ok(())
}

/// ワークスペースDBに接続
#[tauri::command]
pub async fn connect_workspace_db(
    workspace: State<'_, WorkspaceState>,
    db_path: String,
) -> Result<(), String> {
    let mut conn = workspace
        .lock()
        .map_err(|_| "ワークスペース接続のロックに失敗しました".to_string())?;

    conn.connect(PathBuf::from(db_path))
}

/// ワークスペースDBをクローズ
#[tauri::command]
pub async fn close_workspace_db(workspace: State<'_, WorkspaceState>) -> Result<(), String> {
    let mut conn = workspace
        .lock()
        .map_err(|_| "ワークスペース接続のロックに失敗しました".to_string())?;

    conn.close();
    Ok(())
}

/// グローバル設定を保存（アプリケーションレベル）
#[tauri::command]
pub async fn save_global_setting(
    app_handle: tauri::AppHandle,
    key: String,
    value: String,
) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("アプリデータディレクトリの取得に失敗: {}", e))?;

    let settings_path = app_data_dir.join("global_settings.json");

    // 既存の設定を読み込む
    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = std::fs::read_to_string(&settings_path).unwrap_or_else(|_| "{}".to_string());
        serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // 設定を更新
    settings[key] = serde_json::Value::String(value);

    // ディレクトリを作成
    if let Some(parent) = settings_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("ディレクトリ作成エラー: {}", e))?;
    }

    // ファイルに保存
    std::fs::write(
        settings_path,
        serde_json::to_string_pretty(&settings).map_err(|e| format!("JSON変換エラー: {}", e))?,
    )
    .map_err(|e| format!("ファイル書き込みエラー: {}", e))?;

    Ok(())
}

/// グローバル設定を取得
#[tauri::command]
pub async fn get_global_setting(
    app_handle: tauri::AppHandle,
    key: String,
) -> Result<Option<String>, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("アプリデータディレクトリの取得に失敗: {}", e))?;

    let settings_path = app_data_dir.join("global_settings.json");

    if !settings_path.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(settings_path)
        .map_err(|e| format!("ファイル読み込みエラー: {}", e))?;

    let settings: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("JSON解析エラー: {}", e))?;

    if let Some(value) = settings.get(&key) {
        if let Some(str_value) = value.as_str() {
            Ok(Some(str_value.to_string()))
        } else {
            Ok(None)
        }
    } else {
        Ok(None)
    }
}
