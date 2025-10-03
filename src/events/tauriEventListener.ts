import { listen, UnlistenFn, emit } from '@tauri-apps/api/event';
import { useWorkspaceStore, WorkspaceImage } from '../stores/workspaceStore';
import { WorkspaceManager, WorkspaceSettings } from '../services/workspaceManager';
import { DatabaseService, ProcessedImagePreview } from '../services/database';

export interface DataChangeEvent {
  type: 'ImageUpserted' | 'ImageDeleted' | 'AudioUpdated' | 'BackgroundChanged' | 
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

  private convertPreview(preview: ProcessedImagePreview): WorkspaceImage {
    return {
      id: preview.id,
      originalFileName: preview.originalFileName,
      savedFileName: preview.savedFileName,
      createdAt: preview.createdAt,
      displayStartedAt: preview.displayStartedAt ?? null,
    };
  }

  private convertMetadata(raw: any): WorkspaceImage | null {
    const payload = raw?.image ?? raw;
    if (!payload || payload.image_type !== 'processed') {
      return null;
    }
    return {
      id: payload.id,
      originalFileName: payload.original_file_name,
      savedFileName: payload.saved_file_name,
      createdAt: payload.created_at,
      displayStartedAt: payload.display_started_at ?? null,
    };
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
        case 'ImageUpserted': {
          const workspaceImage = this.convertMetadata(data);
          if (workspaceImage) {
            store.upsertProcessedImage(workspaceImage);
            emit('image-list-updated');
          }
          break;
        }
        case 'ImageDeleted':
          if (data?.id) {
            store.removeProcessedImage(data.id);
            emit('image-list-updated');
          }
          break;
        case 'AnimationSettingsChanged':
          emit('image-list-updated');
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

      await this.updateImageList();
    });
    
    this.unlisteners.push(workspaceChangedUnlisten);

    const workspaceSettingsUpdatedUnlisten = await listen<WorkspaceSettings>('workspace-settings-updated', (event) => {
      const payload = event.payload;
      if (!payload) {
        return;
      }
      const store = useWorkspaceStore.getState();
      store.setSettings(payload);
    });

    this.unlisteners.push(workspaceSettingsUpdatedUnlisten);
  }
  
  /**
   * データベースから画像リストを取得してストアを更新
   */
  private async updateImageList(): Promise<void> {
    try {
      const store = useWorkspaceStore.getState();
      const aggregated: WorkspaceImage[] = [];
      const batchSize = 100;
      let cursor: number | null = 0;
      let lastCursor: number | null = null;

      while (true) {
        const batch = await DatabaseService.getProcessedImagesPreview(cursor ?? undefined, batchSize);
        if (batch.length === 0) {
          break;
        }
        batch.forEach(item => aggregated.push(this.convertPreview(item)));
        lastCursor = batch[batch.length - 1].cursor;
        cursor = lastCursor;
        if (batch.length < batchSize) {
          break;
        }
      }

      aggregated.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      store.setProcessedImages(aggregated);
      store.setProcessedCursor(lastCursor);

      console.log(`[TauriEventListener] Updated processed image list (count=${aggregated.length})`);

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
