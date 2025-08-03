import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { AppSettingsService, MovementSettingsService, ImageMetadataService } from './database';

interface AutoImportStarted {
  image_id: string;
  original_path: string;
}

interface AutoImportResult {
  image_id: string;
  original_path: string;
  processed_path: string;
  animation_settings: AnimationSettings;
}

interface AutoImportError {
  image_id: string;
  error: string;
}

interface AnimationSettings {
  animation_type: string;
  speed: number;
  size: number;
}

export class AutoImportService {
  private static instance: AutoImportService;
  private static isStarting = false; // 開始中フラグを追加
  private isWatching = false;
  private unlisteners: Array<() => void> = [];
  private processingImages = new Map<string, { path: string, startTime: number }>();

  private constructor() {}

  static getInstance(): AutoImportService {
    if (!AutoImportService.instance) {
      AutoImportService.instance = new AutoImportService();
    }
    return AutoImportService.instance;
  }

  async startWatching(watchPath: string): Promise<void> {
    if (this.isWatching || AutoImportService.isStarting) {
      console.warn('Already watching or starting to watch a folder');
      return;
    }

    AutoImportService.isStarting = true;
    console.log('[AutoImportService] Starting folder watching:', watchPath);

    try {
      // Rust側でフォルダ監視を開始
      await invoke('start_folder_watching', { watchPath });
      
      // 複数のイベントリスナーを設定
      const startListener = await listen<AutoImportStarted>('auto-import-started', (event) => {
        console.log('Auto import started:', event.payload);
        this.handleAutoImportStarted(event.payload);
      });
      
      const completeListener = await listen<AutoImportResult>('auto-import-complete', async (event) => {
        console.log('Auto import complete:', event.payload);
        await this.handleAutoImportComplete(event.payload);
      });
      
      const errorListener = await listen<AutoImportError>('auto-import-error', (event) => {
        console.error('Auto import error:', event.payload);
        this.handleAutoImportError(event.payload);
      });
      
      this.unlisteners = [startListener, completeListener, errorListener];
      this.isWatching = true;
      console.log(`Started watching folder: ${watchPath}`);
      
      // 設定を保存
      await AppSettingsService.setAutoImportPath(watchPath);
      await AppSettingsService.setAutoImportEnabled(true);
    } catch (error) {
      console.error('Failed to start folder watching:', error);
      throw error;
    } finally {
      AutoImportService.isStarting = false;
    }
  }

  async stopWatching(): Promise<void> {
    if (!this.isWatching) {
      return;
    }

    // Rust側のfile watcherを停止
    try {
      await invoke('stop_folder_watching');
    } catch (error) {
      console.error('Failed to stop folder watching:', error);
    }

    // すべてのイベントリスナーを解除
    this.unlisteners.forEach(unlisten => unlisten());
    this.unlisteners = [];
    
    this.isWatching = false;
    this.processingImages.clear();
    console.log('Stopped watching folder');
    
    // 設定を更新
    await AppSettingsService.setAutoImportEnabled(false);
  }

  private handleAutoImportStarted(data: AutoImportStarted): void {
    const { image_id, original_path } = data;
    
    // 処理中の画像情報を保存
    this.processingImages.set(image_id, {
      path: original_path,
      startTime: Date.now()
    });
    
    // プレースホルダーを表示するためのイベントを発行
    window.dispatchEvent(new CustomEvent('auto-import-progress', {
      detail: { 
        imageId: image_id, 
        status: 'processing',
        fileName: original_path.split('/').pop() || 'unknown'
      }
    }));
  }

  private async handleAutoImportComplete(result: AutoImportResult): Promise<void> {
    const { image_id, original_path, processed_path, animation_settings } = result;

    try {
      // 処理時間を計算
      const processingInfo = this.processingImages.get(image_id);
      if (processingInfo) {
        const processingTime = Date.now() - processingInfo.startTime;
        console.log(`Processing time for ${image_id}: ${processingTime}ms`);
        this.processingImages.delete(image_id);
      }
      
      // 画像メタデータを保存
      await ImageMetadataService.saveImageMetadata({
        id: image_id,
        original_file_name: original_path.split('/').pop() || 'unknown',
        saved_file_name: processed_path.split('/').pop() || 'unknown',
        image_type: 'processed',
        created_at: new Date().toISOString(),
        size: 0, // TODO: 実際のファイルサイズを取得
        storage_location: 'workspace',
        file_path: processed_path
      });

      // アニメーションタイプから動きタイプを判定
      const walkTypes = ['normal', 'slow', 'fast'];
      const isWalkType = walkTypes.includes(animation_settings.animation_type);
      
      // アニメーション設定を保存
      await MovementSettingsService.saveMovementSettings({
        image_id,
        movement_type: isWalkType ? 'walk' : 'fly',
        movement_pattern: animation_settings.animation_type,
        speed: animation_settings.speed,
        size: animation_settings.size.toString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      // 完了イベントを発行
      window.dispatchEvent(new CustomEvent('auto-import-progress', {
        detail: { 
          imageId: image_id, 
          status: 'complete',
          fileName: processed_path.split('/').pop() || 'unknown'
        }
      }));

      console.log(`Auto-imported image: ${image_id}`);
    } catch (error) {
      console.error('Failed to handle auto import:', error);
      this.handleAutoImportError({ image_id, error: String(error) });
    }
  }
  
  private handleAutoImportError(data: AutoImportError): void {
    const { image_id, error } = data;
    
    // 処理中の情報を削除
    this.processingImages.delete(image_id);
    
    // エラーイベントを発行
    window.dispatchEvent(new CustomEvent('auto-import-progress', {
      detail: { 
        imageId: image_id, 
        status: 'error',
        error: error
      }
    }));
    
    console.error(`Auto import failed for ${image_id}:`, error);
  }

  isCurrentlyWatching(): boolean {
    return this.isWatching;
  }
}