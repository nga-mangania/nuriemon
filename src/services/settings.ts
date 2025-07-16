import { readFile, writeFile, exists, BaseDirectory } from '@tauri-apps/plugin-fs';
import { join, appDataDir, pictureDir, downloadDir, documentDir } from '@tauri-apps/api/path';
import { DatabaseService, UserSettings } from './database';

export interface AppSettings {
  saveLocation: 'appData' | 'pictures' | 'downloads' | 'documents' | 'custom';
  customPath?: string;
  autoSave: boolean;
  // UploadPage settings
  backgroundUrl?: string | null;
  backgroundType?: string | null;
  groundPosition?: number;
  deletionTime?: string;
  lastMovementSettings?: any;
  // ShareUrl settings
  shareUrl?: string | null;
  shareId?: string | null;
}

const SETTINGS_FILE = 'settings.json';

// デフォルト設定
const defaultSettings: AppSettings = {
  saveLocation: 'appData',
  autoSave: true,
  backgroundUrl: null,
  backgroundType: null,
  groundPosition: 50,
  deletionTime: 'unlimited',
  lastMovementSettings: null,
  shareUrl: null,
  shareId: null,
};

// 設定のキャッシュ（パフォーマンス向上のため）
let settingsCache: AppSettings | null = null;

/**
 * 設定を読み込む
 */
export async function loadSettings(): Promise<AppSettings> {
  try {
    // まずSQLiteから読み込みを試みる
    const dbSettings = await DatabaseService.getUserSettings();
    
    if (dbSettings) {
      const settings: AppSettings = {
        saveLocation: dbSettings.location_type as AppSettings['saveLocation'],
        customPath: dbSettings.location_type === 'custom' ? dbSettings.storage_location : undefined,
        autoSave: true, // 現在のスキーマには含まれていないため、デフォルト値を使用
      };
      settingsCache = settings;
      return settings;
    }
    
    // SQLiteにデータがない場合は、既存のJSONファイルから読み込み
    const settingsPath = await join(await appDataDir(), SETTINGS_FILE);
    
    if (await exists(settingsPath, { baseDir: BaseDirectory.AppData })) {
      const data = await readFile(settingsPath, { baseDir: BaseDirectory.AppData });
      const jsonStr = new TextDecoder().decode(data);
      const jsonSettings = { ...defaultSettings, ...JSON.parse(jsonStr) };
      
      // SQLiteに移行
      await migrateSettingsToDatabase(jsonSettings);
      
      settingsCache = jsonSettings;
      return jsonSettings;
    }
  } catch (error) {
    console.error('設定読み込みエラー:', error);
  }
  
  // デフォルト設定をSQLiteに保存
  await migrateSettingsToDatabase(defaultSettings);
  settingsCache = defaultSettings;
  return defaultSettings;
}

/**
 * 設定を保存
 */
export async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    // SQLiteに保存
    const dbSettings: UserSettings = {
      id: 'default-user', // 現在はシングルユーザー想定
      storage_location: settings.customPath || await getSaveDirectory(settings),
      location_type: settings.saveLocation,
      created_at: await DatabaseService.getCurrentTimestamp(),
      updated_at: await DatabaseService.getCurrentTimestamp(),
    };
    
    await DatabaseService.saveUserSettings(dbSettings);
    
    // キャッシュを更新
    settingsCache = settings;
    
    // 後方互換性のため、JSONファイルにも保存（将来的に削除予定）
    const settingsPath = await join(await appDataDir(), SETTINGS_FILE);
    const jsonData = JSON.stringify(settings, null, 2);
    await writeFile(settingsPath, new TextEncoder().encode(jsonData), { baseDir: BaseDirectory.AppData });
  } catch (error) {
    console.error('設定保存エラー:', error);
    throw error;
  }
}

/**
 * 既存の設定をデータベースに移行
 */
async function migrateSettingsToDatabase(settings: AppSettings): Promise<void> {
  try {
    const dbSettings: UserSettings = {
      id: 'default-user',
      storage_location: settings.customPath || await getSaveDirectory(settings),
      location_type: settings.saveLocation,
      created_at: await DatabaseService.getCurrentTimestamp(),
      updated_at: await DatabaseService.getCurrentTimestamp(),
    };
    
    await DatabaseService.saveUserSettings(dbSettings);
  } catch (error) {
    console.error('設定のデータベース移行エラー:', error);
  }
}

/**
 * 保存先のパスを取得
 */
export async function getSaveDirectory(settings?: AppSettings): Promise<string> {
  const currentSettings = settings || settingsCache || await loadSettings();
  
  let directory: string;
  
  switch (currentSettings.saveLocation) {
    case 'pictures':
      directory = await pictureDir();
      break;
    case 'downloads':
      directory = await downloadDir();
      break;
    case 'documents':
      directory = await documentDir();
      break;
    case 'custom':
      directory = currentSettings.customPath || await appDataDir();
      break;
    case 'appData':
    default:
      directory = await appDataDir();
      break;
  }
  
  return directory;
}

/**
 * 保存場所の表示名を取得
 */
export function getSaveLocationName(location: AppSettings['saveLocation']): string {
  switch (location) {
    case 'appData':
      return 'アプリケーションデータ';
    case 'pictures':
      return 'ピクチャフォルダ';
    case 'downloads':
      return 'ダウンロードフォルダ';
    case 'documents':
      return 'ドキュメントフォルダ';
    case 'custom':
      return 'カスタム';
    default:
      return '不明';
  }
}