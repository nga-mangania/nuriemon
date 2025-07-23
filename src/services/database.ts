import { invoke } from '@tauri-apps/api/core';
import { WorkspaceManager } from './workspaceManager';

export interface ImageMetadata {
  id: string;
  original_file_name: string;
  saved_file_name: string;
  image_type: 'original' | 'processed';
  created_at: string;
  size: number;
  width?: number;
  height?: number;
  storage_location: string;
  file_path?: string | null;
}

export interface UserSettings {
  id: string;
  storage_location: string;
  location_type: 'appData' | 'pictures' | 'downloads' | 'documents' | 'custom';
  created_at: string;
  updated_at: string;
}

export interface ImageCounts {
  original: number;
  processed: number;
}

export interface MovementSettings {
  image_id: string;
  movement_type: string;
  movement_pattern: string;
  speed: number;
  size: string;
  created_at: string;
  updated_at: string;
}

export class DatabaseService {
  // ユニークIDの生成
  static async generateId(): Promise<string> {
    return await invoke<string>('generate_unique_id');
  }

  // 現在のタイムスタンプ取得
  static async getCurrentTimestamp(): Promise<string> {
    return await invoke<string>('get_current_timestamp');
  }

  // 画像のfile_pathを更新
  static async updateImageFilePath(id: string, filePath: string): Promise<void> {
    await invoke('update_image_file_path', { id, filePath });
  }

  // 画像メタデータの保存
  static async saveImageMetadata(metadata: ImageMetadata): Promise<void> {
    await invoke('save_image_metadata', { metadata });
  }

  // 全画像メタデータの取得
  static async getAllImages(): Promise<ImageMetadata[]> {
    return await invoke<ImageMetadata[]>('get_all_images');
  }

  // 画像の削除
  static async deleteImage(id: string): Promise<void> {
    await invoke('delete_image', { id });
  }

  // 画像の存在確認
  static async imageExists(id: string): Promise<boolean> {
    try {
      const images = await DatabaseService.getAllImages();
      return images.some(img => img.id === id);
    } catch {
      return false;
    }
  }

  // ユーザー設定の保存
  static async saveUserSettings(settings: UserSettings): Promise<void> {
    await invoke('save_user_settings', { settings });
  }

  // ユーザー設定の取得
  static async getUserSettings(): Promise<UserSettings | null> {
    return await invoke<UserSettings | null>('get_user_settings');
  }

  // 画像数の取得
  static async getImageCounts(): Promise<ImageCounts> {
    const [original, processed] = await invoke<[number, number]>('get_image_counts');
    return { original, processed };
  }

  // 動き設定の保存
  static async saveMovementSettings(settings: MovementSettings): Promise<void> {
    await invoke('save_movement_settings', { settings });
  }

  // 動き設定の取得
  static async getMovementSettings(imageId: string): Promise<MovementSettings | null> {
    return await invoke<MovementSettings | null>('get_movement_settings', { imageId });
  }

  // すべての動き設定の取得
  static async getAllMovementSettings(): Promise<MovementSettings[]> {
    return await invoke<MovementSettings[]>('get_all_movement_settings');
  }
}

// 既存のJSONベースのデータをSQLiteに移行するヘルパー関数
export async function migrateFromJSON(jsonData: any[]): Promise<void> {
  let migratedCount = 0;
  let skippedCount = 0;
  
  for (const item of jsonData) {
    const id = item.id || await DatabaseService.generateId();
    
    // 既にデータベースに存在するかチェック
    if (await DatabaseService.imageExists(id)) {
      skippedCount++;
      continue;
    }
    
    // 既存のデータ構造をSQLiteの構造に変換
    const metadata: ImageMetadata = {
      id,
      original_file_name: item.originalFileName || item.original_file_name || '',
      saved_file_name: item.savedFileName || item.saved_file_name || '',
      image_type: item.type || item.image_type || 'original',
      created_at: item.createdAt || item.created_at || await DatabaseService.getCurrentTimestamp(),
      size: item.size || 0,
      width: item.width,
      height: item.height,
      storage_location: item.storage_location || ''
    };

    try {
      await DatabaseService.saveImageMetadata(metadata);
      migratedCount++;
    } catch (error) {
      console.error('Failed to migrate image:', item, error);
    }
  }
  
  console.log(`移行完了: ${migratedCount}件を新規移行、${skippedCount}件は既存のためスキップ`);
}

export class ImageMetadataService {
  // ImageMetadataのエイリアスとして、DatabaseServiceのメソッドを提供
  static saveImageMetadata = DatabaseService.saveImageMetadata;
  static getAllImages = DatabaseService.getAllImages;
  static deleteImage = DatabaseService.deleteImage;
  static imageExists = DatabaseService.imageExists;
  static updateImageFilePath = DatabaseService.updateImageFilePath;
}

export class MovementSettingsService {
  // MovementSettingsのエイリアスとして、DatabaseServiceのメソッドを提供
  static saveMovementSettings = DatabaseService.saveMovementSettings;
  static getMovementSettings = DatabaseService.getMovementSettings;
  static getAllMovementSettings = DatabaseService.getAllMovementSettings;
}

export class AppSettingsService {
  // ワークスペース設定の保存
  static async saveAppSetting(key: string, value: string): Promise<void> {
    const manager = WorkspaceManager.getInstance();
    const settings = await manager.getWorkspaceSettings();
    
    if (!settings) {
      throw new Error('ワークスペースが選択されていません');
    }
    
    // ワークスペース設定に保存
    await manager.saveWorkspaceSettings({ [key]: value });
  }

  // ワークスペース設定の取得
  static async getAppSetting(key: string): Promise<string | null> {
    const manager = WorkspaceManager.getInstance();
    const settings = await manager.getWorkspaceSettings();
    
    if (!settings) {
      return null;
    }
    
    return (settings as any)[key] || null;
  }

  // 複数のワークスペース設定の取得
  static async getAppSettings(keys: string[]): Promise<Record<string, string>> {
    const manager = WorkspaceManager.getInstance();
    const settings = await manager.getWorkspaceSettings();
    
    if (!settings) {
      return {};
    }
    
    const result: Record<string, string> = {};
    for (const key of keys) {
      const value = (settings as any)[key];
      if (value !== undefined) {
        result[key] = String(value);
      }
    }
    return result;
  }

  // 地面位置の保存
  static async saveGroundPosition(position: number): Promise<void> {
    await AppSettingsService.saveAppSetting('ground_position', position.toString());
  }

  // 地面位置の取得
  static async getGroundPosition(): Promise<number> {
    const value = await AppSettingsService.getAppSetting('ground_position');
    return value ? parseInt(value, 10) : 50; // デフォルト値は50
  }

  // 削除時間の保存
  static async saveDeletionTime(time: string): Promise<void> {
    await AppSettingsService.saveAppSetting('deletion_time', time);
  }

  // 削除時間の取得
  static async getDeletionTime(): Promise<string> {
    const value = await AppSettingsService.getAppSetting('deletion_time');
    return value || 'unlimited';
  }

  // 地面位置の更新（エイリアス）
  static async updateGroundPosition(position: number): Promise<void> {
    await AppSettingsService.saveGroundPosition(position);
  }

  // 設定の取得（フォルダ設定用）
  static async getSettings(): Promise<{saveLocation: string, customPath: string}> {
    const manager = WorkspaceManager.getInstance();
    const currentWorkspace = manager.getCurrentWorkspace();
    
    if (!currentWorkspace) {
      return {
        saveLocation: 'workspace',
        customPath: ''
      };
    }
    
    return {
      saveLocation: 'workspace',
      customPath: currentWorkspace
    };
  }

  // 設定の更新（フォルダ設定用）
  static async updateSettings(settings: {saveLocation?: string, customPath?: string}): Promise<void> {
    if (settings.saveLocation !== undefined) {
      await AppSettingsService.saveAppSetting('save_location', settings.saveLocation);
    }
    if (settings.customPath !== undefined) {
      await AppSettingsService.saveAppSetting('custom_path', settings.customPath);
    }
  }

  // 保存先ディレクトリの取得（統一化のため追加）
  static async getSaveDirectory(): Promise<string> {
    const manager = WorkspaceManager.getInstance();
    return await manager.getSaveDirectory();
  }

  // 全ての設定を一括で取得（パフォーマンス向上）
  static async getAllSettings(): Promise<{
    saveLocation: string;
    customPath: string;
    groundPosition: number;
    deletionTime: string;
  }> {
    const manager = WorkspaceManager.getInstance();
    const workspace = manager.getCurrentWorkspace();
    const settings = await manager.getWorkspaceSettings();
    
    if (!workspace || !settings) {
      return {
        saveLocation: 'workspace',
        customPath: '',
        groundPosition: 80,
        deletionTime: 'unlimited'
      };
    }
    
    return {
      saveLocation: 'workspace',
      customPath: workspace,
      groundPosition: settings.groundPosition || 80,
      deletionTime: settings.deletionTime || 'unlimited'
    };
  }
}