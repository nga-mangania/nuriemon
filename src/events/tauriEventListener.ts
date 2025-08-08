import { listen, UnlistenFn, emit } from '@tauri-apps/api/event';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { WorkspaceManager } from '../services/workspaceManager';
import { DatabaseService } from '../services/database';

export interface DataChangeEvent {
  type: 'ImageAdded' | 'ImageDeleted' | 'AudioUpdated' | 'BackgroundChanged' | 
        'AnimationSettingsChanged' | 'GroundPositionChanged' | 'DeletionTimeChanged' | 
        'AppSettingChanged';
  data: any;
}

/**
 * Tauriイベントを受信してZustandストアを更新する中央リスナー
 * アプリケーション起動時に一度だけセットアップされる
 */
export class TauriEventListener {
  private static instance: TauriEventListener;
  private unlisteners: UnlistenFn[] = [];
  
  private constructor() {}
  
  static getInstance(): TauriEventListener {
    if (!TauriEventListener.instance) {
      TauriEventListener.instance = new TauriEventListener();
    }
    return TauriEventListener.instance;
  }
  
  /**
   * すべてのイベントリスナーをセットアップ
   */
  async setupListeners(): Promise<void> {
    // 初期画像リストを読み込む
    await this.updateImageList();
    
    // data-changedイベントのリスナー
    const dataChangeUnlisten = await listen<DataChangeEvent>('data-changed', (event) => {
      const { type, data } = event.payload;
      const store = useWorkspaceStore.getState();
      
      switch (type) {
        case 'GroundPositionChanged':
          store.setGroundPosition(data.position);
          break;
        case 'DeletionTimeChanged':
          store.setDeletionTime(data.time);
          break;
        case 'BackgroundChanged':
          // 背景が変更された場合は、背景を再読み込みする必要がある
          // これは別途処理する必要があるため、現時点では実装しない
          break;
        case 'AppSettingChanged':
          // アプリ設定の変更を処理
          if (data.key === 'groundPosition') {
            store.setGroundPosition(parseInt(data.value));
          } else if (data.key === 'deletionTime') {
            store.setDeletionTime(data.value);
          }
          break;
        case 'ImageAdded':
        case 'ImageDeleted':
        case 'AnimationSettingsChanged':
          // データベースから最新の画像リストを取得してストアを更新
          console.log(`[TauriEventListener] ${type} event received, updating image list`);
          this.updateImageList();
          break;
        // 他のイベントタイプは必要に応じて実装
      }
    });
    
    this.unlisteners.push(dataChangeUnlisten);
    
    // ワークスペース関連のイベント
    const workspaceChangedUnlisten = await listen('workspace-changed', async () => {
      const store = useWorkspaceStore.getState();
      const manager = WorkspaceManager.getInstance();
      
      // ワークスペース設定を再読み込み
      const settings = await manager.getWorkspaceSettings();
      if (settings) {
        store.setSettings(settings);
      }
    });
    
    this.unlisteners.push(workspaceChangedUnlisten);
  }
  
  /**
   * データベースから画像リストを取得してストアを更新
   */
  private async updateImageList(): Promise<void> {
    try {
      // データベースから全画像メタデータを取得
      const dbImages = await DatabaseService.getAllImages();
      
      // データベースの形式からストアの形式に変換
      const images = dbImages.map(dbImage => ({
        id: dbImage.id,
        originalFileName: dbImage.original_file_name,
        savedFileName: dbImage.saved_file_name,
        type: dbImage.image_type as 'original' | 'processed',
        createdAt: dbImage.created_at,
        size: dbImage.size,
        width: dbImage.width,
        height: dbImage.height,
        file_path: dbImage.file_path
      }));
      
      // processedタイプの画像のみをフィルタ
      const processedImages = images.filter(img => img.type === 'processed');
      
      // ストアを更新
      const store = useWorkspaceStore.getState();
      store.setImages(processedImages);
      
      console.log(`[TauriEventListener] Updated image list with ${processedImages.length} processed images`);
      
      // 他のウィンドウにも通知
      emit('image-list-updated');
    } catch (error) {
      console.error('[TauriEventListener] Failed to update image list:', error);
    }
  }

  /**
   * すべてのイベントリスナーをクリーンアップ
   */
  cleanup(): void {
    this.unlisteners.forEach(unlisten => unlisten());
    this.unlisteners = [];
  }
}