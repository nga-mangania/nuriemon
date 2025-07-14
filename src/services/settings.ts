import { readFile, writeFile, exists, BaseDirectory } from '@tauri-apps/plugin-fs';
import { join, appDataDir, pictureDir, downloadDir, documentDir } from '@tauri-apps/api/path';

export interface AppSettings {
  saveLocation: 'appData' | 'pictures' | 'downloads' | 'documents' | 'custom';
  customPath?: string;
  autoSave: boolean;
}

const SETTINGS_FILE = 'settings.json';

// デフォルト設定
const defaultSettings: AppSettings = {
  saveLocation: 'appData',
  autoSave: true,
};

/**
 * 設定を読み込む
 */
export async function loadSettings(): Promise<AppSettings> {
  try {
    const settingsPath = await join(await appDataDir(), SETTINGS_FILE);
    
    if (await exists(settingsPath, { baseDir: BaseDirectory.AppData })) {
      const data = await readFile(settingsPath, { baseDir: BaseDirectory.AppData });
      const jsonStr = new TextDecoder().decode(data);
      return { ...defaultSettings, ...JSON.parse(jsonStr) };
    }
  } catch (error) {
    console.error('設定読み込みエラー:', error);
  }
  
  return defaultSettings;
}

/**
 * 設定を保存
 */
export async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    const settingsPath = await join(await appDataDir(), SETTINGS_FILE);
    const jsonData = JSON.stringify(settings, null, 2);
    await writeFile(settingsPath, new TextEncoder().encode(jsonData), { baseDir: BaseDirectory.AppData });
  } catch (error) {
    console.error('設定保存エラー:', error);
    throw error;
  }
}

/**
 * 保存先のパスを取得
 */
export async function getSaveDirectory(settings?: AppSettings): Promise<string> {
  const currentSettings = settings || await loadSettings();
  console.log('getSaveDirectory: 現在の設定', currentSettings);
  
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
  
  console.log('getSaveDirectory: 選択されたディレクトリ', directory);
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