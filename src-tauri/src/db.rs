use rusqlite::{Connection, Result, params};
use serde::{Serialize, Deserialize};
use std::path::PathBuf;
use uuid::Uuid;
use chrono::Utc;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImageMetadata {
    pub id: String,
    pub original_file_name: String,
    pub saved_file_name: String,
    pub image_type: String, // "original" or "processed"
    pub created_at: String,
    pub size: i64,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub storage_location: String, // 保存先のパス
    #[serde(default)]
    pub file_path: Option<String>, // ファイルの完全パス
    #[serde(default)]
    pub is_hidden: i32, // 0 or 1
    #[serde(default)]
    pub display_started_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProcessedImagePreview {
    pub cursor: i64,
    pub id: String,
    pub original_file_name: String,
    pub saved_file_name: String,
    pub created_at: String,
    #[serde(default)]
    pub display_started_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserSettings {
    pub id: String,
    pub storage_location: String,
    pub location_type: String, // "app_data", "pictures", "downloads", "documents", "custom"
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MovementSettings {
    pub image_id: String,
    pub movement_type: String, // "walk", "fly", "swim"
    pub movement_pattern: String, // "normal", "zigzag", "bounce", etc.
    pub speed: f32, // 0.0 to 1.0
    pub size: String, // "small", "medium", "large"
    pub created_at: String,
    pub updated_at: String,
}

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn new(db_path: PathBuf) -> Result<Self> {
        let conn = Connection::open(db_path)?;
        Ok(Database { conn })
    }

    pub fn initialize(&self) -> Result<()> {
        // イメージメタデータテーブル
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS images (
                id TEXT PRIMARY KEY,
                original_file_name TEXT NOT NULL,
                saved_file_name TEXT NOT NULL,
                image_type TEXT NOT NULL,
                created_at TEXT NOT NULL,
                size INTEGER NOT NULL,
                width INTEGER,
                height INTEGER,
                storage_location TEXT NOT NULL
            )",
            [],
        )?;

        // ユーザー設定テーブル
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS user_settings (
                id TEXT PRIMARY KEY,
                storage_location TEXT NOT NULL,
                location_type TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )?;

        // 動き設定テーブル
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS movement_settings (
                image_id TEXT PRIMARY KEY,
                movement_type TEXT NOT NULL,
                movement_pattern TEXT NOT NULL,
                speed REAL NOT NULL,
                size TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
            )",
            [],
        )?;

        // インデックス作成
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_images_created_at ON images (created_at DESC)",
            [],
        )?;

        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_images_type ON images (image_type)",
            [],
        )?;

        // filePathカラムを追加（既存のテーブルに）
        match self.conn.execute(
            "ALTER TABLE images ADD COLUMN file_path TEXT",
            [],
        ) {
            Ok(_) => {},
            Err(e) => {
                // カラムが既に存在する場合はエラーを無視
                if !e.to_string().contains("duplicate column name") {
                    return Err(e);
                }
            }
        }

        // is_hidden カラムの追加
        match self.conn.execute(
            "ALTER TABLE images ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0",
            [],
        ) {
            Ok(_) => {},
            Err(e) => {
                if !e.to_string().contains("duplicate column name") {
                    return Err(e);
                }
            }
        }
        // display_started_at カラムの追加
        match self.conn.execute(
            "ALTER TABLE images ADD COLUMN display_started_at TEXT",
            [],
        ) {
            Ok(_) => {},
            Err(e) => {
                if !e.to_string().contains("duplicate column name") {
                    return Err(e);
                }
            }
        }
        // インデックス
        let _ = self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_images_hidden ON images (is_hidden)",
            [],
        );

        // アプリケーション設定テーブル
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )?;

        Ok(())
    }

    // 画像メタデータの保存
    pub fn save_image_metadata(&self, metadata: &ImageMetadata) -> Result<()> {
        self.conn.execute(
            "INSERT INTO images (id, original_file_name, saved_file_name, image_type, created_at, size, width, height, storage_location, file_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                metadata.id,
                metadata.original_file_name,
                metadata.saved_file_name,
                metadata.image_type,
                metadata.created_at,
                metadata.size,
                metadata.width,
                metadata.height,
                metadata.storage_location,
                metadata.file_path,
            ],
        )?;
        Ok(())
    }

    // 特定の画像メタデータを取得
    pub fn get_image(&self, id: &str) -> Result<Option<ImageMetadata>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, original_file_name, saved_file_name, image_type, created_at, size, width, height, storage_location, file_path, is_hidden, display_started_at 
             FROM images 
             WHERE id = ?1"
        )?;

        let mut images = stmt.query_map([id], |row| {
            Ok(ImageMetadata {
                id: row.get(0)?,
                original_file_name: row.get(1)?,
                saved_file_name: row.get(2)?,
                image_type: row.get(3)?,
                created_at: row.get(4)?,
                size: row.get(5)?,
                width: row.get(6)?,
                height: row.get(7)?,
                storage_location: row.get(8)?,
                file_path: row.get(9)?,
                is_hidden: row.get(10).unwrap_or(0),
                display_started_at: row.get(11).ok(),
            })
        })?;

        match images.next() {
            Some(image) => Ok(Some(image?)),
            None => Ok(None),
        }
    }

    // 画像メタデータの取得（全件）
    pub fn get_all_images(&self) -> Result<Vec<ImageMetadata>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, original_file_name, saved_file_name, image_type, created_at, size, width, height, storage_location, file_path, is_hidden, display_started_at 
             FROM images 
             ORDER BY created_at DESC"
        )?;

        let images = stmt.query_map([], |row| {
            Ok(ImageMetadata {
                id: row.get(0)?,
                original_file_name: row.get(1)?,
                saved_file_name: row.get(2)?,
                image_type: row.get(3)?,
                created_at: row.get(4)?,
                size: row.get(5)?,
                width: row.get(6)?,
                height: row.get(7)?,
                storage_location: row.get(8)?,
                file_path: row.get(9)?,
                is_hidden: row.get(10).unwrap_or(0),
                display_started_at: row.get(11).ok(),
            })
        })?;

        let mut result = Vec::new();
        for image in images {
            result.push(image?);
        }
        Ok(result)
    }

    pub fn get_processed_images_preview(&self, last_cursor: Option<i64>, limit: i64) -> Result<Vec<ProcessedImagePreview>> {
        let cursor = last_cursor.unwrap_or(0);
        let limit = if limit <= 0 { 60 } else { limit.min(500) };

        let mut stmt = self.conn.prepare(
            "SELECT rowid, id, original_file_name, saved_file_name, created_at, display_started_at
             FROM images
             WHERE image_type = 'processed'
               AND (is_hidden IS NULL OR is_hidden = 0)
               AND rowid > ?1
             ORDER BY rowid
             LIMIT ?2"
        )?;

        let rows = stmt.query_map(params![cursor, limit], |row| {
            Ok(ProcessedImagePreview {
                cursor: row.get(0)?,
                id: row.get(1)?,
                original_file_name: row.get(2)?,
                saved_file_name: row.get(3)?,
                created_at: row.get(4)?,
                display_started_at: row.get(5).ok(),
            })
        })?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }

        Ok(result)
    }

    // 特定の画像メタデータの取得
    #[allow(dead_code)]
    pub fn get_image_by_id(&self, id: &str) -> Result<Option<ImageMetadata>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, original_file_name, saved_file_name, image_type, created_at, size, width, height, storage_location, file_path, is_hidden, display_started_at 
             FROM images 
             WHERE id = ?1"
        )?;

        let mut images = stmt.query_map([id], |row| {
            Ok(ImageMetadata {
                id: row.get(0)?,
                original_file_name: row.get(1)?,
                saved_file_name: row.get(2)?,
                image_type: row.get(3)?,
                created_at: row.get(4)?,
                size: row.get(5)?,
                width: row.get(6)?,
                height: row.get(7)?,
                storage_location: row.get(8)?,
                file_path: row.get(9)?,
                is_hidden: row.get(10).unwrap_or(0),
                display_started_at: row.get(11).ok(),
            })
        })?;

        match images.next() {
            Some(image) => Ok(Some(image?)),
            None => Ok(None),
        }
    }

    // 画像の削除
    pub fn delete_image(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM images WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn mark_display_started_if_null(&self, id: &str) -> Result<()> {
        let now = current_timestamp();
        self.conn.execute(
            "UPDATE images SET display_started_at = COALESCE(display_started_at, ?1) WHERE id = ?2",
            params![now, id],
        )?;
        Ok(())
    }

    // 画像のfile_pathを更新
    pub fn update_image_file_path(&self, id: &str, file_path: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE images SET file_path = ?1 WHERE id = ?2",
            params![file_path, id]
        )?;
        Ok(())
    }

    // ユーザー設定の保存/更新
    pub fn save_user_settings(&self, settings: &UserSettings) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO user_settings (id, storage_location, location_type, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                settings.id,
                settings.storage_location,
                settings.location_type,
                settings.created_at,
                settings.updated_at,
            ],
        )?;
        Ok(())
    }

    // ユーザー設定の取得
    pub fn get_user_settings(&self) -> Result<Option<UserSettings>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, storage_location, location_type, created_at, updated_at 
             FROM user_settings 
             ORDER BY updated_at DESC 
             LIMIT 1"
        )?;

        let mut settings = stmt.query_map([], |row| {
            Ok(UserSettings {
                id: row.get(0)?,
                storage_location: row.get(1)?,
                location_type: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?;

        match settings.next() {
            Some(setting) => Ok(Some(setting?)),
            None => Ok(None),
        }
    }

    // タイプ別画像数の取得
    pub fn get_image_counts(&self) -> Result<(i32, i32)> {
        let original_count: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM images WHERE image_type = 'original'",
            [],
            |row| row.get(0),
        )?;

        let processed_count: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM images WHERE image_type = 'processed'",
            [],
            |row| row.get(0),
        )?;

        Ok((original_count, processed_count))
    }

    // 動き設定の保存
    pub fn save_movement_settings(&self, settings: &MovementSettings) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO movement_settings 
             (image_id, movement_type, movement_pattern, speed, size, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                settings.image_id,
                settings.movement_type,
                settings.movement_pattern,
                settings.speed,
                settings.size,
                settings.created_at,
                settings.updated_at,
            ],
        )?;
        Ok(())
    }

    // 動き設定の取得
    pub fn get_movement_settings(&self, image_id: &str) -> Result<Option<MovementSettings>> {
        let mut stmt = self.conn.prepare(
            "SELECT image_id, movement_type, movement_pattern, speed, size, created_at, updated_at
             FROM movement_settings 
             WHERE image_id = ?1"
        )?;

        let mut settings = stmt.query_map([image_id], |row| {
            Ok(MovementSettings {
                image_id: row.get(0)?,
                movement_type: row.get(1)?,
                movement_pattern: row.get(2)?,
                speed: row.get(3)?,
                size: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?;

        match settings.next() {
            Some(setting) => Ok(Some(setting?)),
            None => Ok(None),
        }
    }

    // すべての動き設定を取得
    pub fn get_all_movement_settings(&self) -> Result<Vec<MovementSettings>> {
        let mut stmt = self.conn.prepare(
            "SELECT image_id, movement_type, movement_pattern, speed, size, created_at, updated_at
             FROM movement_settings"
        )?;

        let settings = stmt.query_map([], |row| {
            Ok(MovementSettings {
                image_id: row.get(0)?,
                movement_type: row.get(1)?,
                movement_pattern: row.get(2)?,
                speed: row.get(3)?,
                size: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?;

        let mut result = Vec::new();
        for setting in settings {
            result.push(setting?);
        }
        Ok(result)
    }

    // アプリケーション設定の保存
    pub fn save_app_setting(&self, key: &str, value: &str) -> Result<()> {
        let now = current_timestamp();
        self.conn.execute(
            "INSERT OR REPLACE INTO app_settings (key, value, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?3)",
            params![key, value, now],
        )?;
        Ok(())
    }

    // アプリケーション設定の取得
    pub fn get_app_setting(&self, key: &str) -> Result<Option<String>> {
        match self.conn.query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        ) {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    // 複数のアプリケーション設定を一度に取得
    pub fn get_app_settings(&self, keys: &[&str]) -> Result<std::collections::HashMap<String, String>> {
        let mut result = std::collections::HashMap::new();
        
        let placeholders = keys.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let query = format!("SELECT key, value FROM app_settings WHERE key IN ({})", placeholders);
        
        let mut stmt = self.conn.prepare(&query)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(keys), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        
        for row in rows {
            let (key, value) = row?;
            result.insert(key, value);
        }
        
        Ok(result)
    }
}

// ヘルパー関数
pub fn generate_id() -> String {
    Uuid::new_v4().to_string()
}

pub fn current_timestamp() -> String {
    Utc::now().to_rfc3339()
}
