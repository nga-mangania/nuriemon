import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { useWorkspaceStore, WorkspaceImage } from '../stores/workspaceStore';
import { WorkspaceManager, WorkspaceSettings } from '../services/workspaceManager';
import { DatabaseService, ProcessedImagePreview } from '../services/database';

type ImageUpsertedPayload = {
  id: string;
  original_file_name: string;
  saved_file_name: string;
  image_type: string;
  created_at: string;
  display_started_at?: string | null;
};

type DataChangeEvent =
  | { type: 'image-upserted'; payload: ImageUpsertedPayload }
  | { type: 'image-deleted'; payload: { id: string } }
  | { type: 'audio-updated'; payload: { audio_type: string } }
  | { type: 'background-changed' }
  | { type: 'animation-settings-changed'; payload: { image_id: string } }
  | { type: 'ground-position-changed'; payload: { position: number } }
  | { type: 'deletion-time-changed'; payload: { time: string } }
  | { type: 'app-setting-changed'; payload: { key: string; value: string } };

/**
 * Tauriイベントを受信してZustandストアを更新する中央リスナー
 * アプリケーション起動時に一度だけセットアップされる
 */
export class TauriEventListener {
  private static instance: TauriEventListener;
  private unlisteners: UnlistenFn[] = [];
  private isHydrating = false;
  private pendingEvents: DataChangeEvent[] = [];
  
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

  private convertUpsertedPayload(payload: ImageUpsertedPayload): WorkspaceImage | null {
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

  private applyDataChange(eventData: DataChangeEvent): void {
    const store = useWorkspaceStore.getState();

    switch (eventData.type) {
      case 'ground-position-changed':
        store.setGroundPosition(eventData.payload.position);
        break;
      case 'deletion-time-changed':
        store.setDeletionTime(eventData.payload.time);
        break;
      case 'background-changed':
        break;
      case 'app-setting-changed':
        if (eventData.payload.key === 'groundPosition') {
          store.setGroundPosition(parseInt(eventData.payload.value));
        } else if (eventData.payload.key === 'deletionTime') {
          store.setDeletionTime(eventData.payload.value);
        }
        break;
      case 'image-upserted': {
        const workspaceImage = this.convertUpsertedPayload(eventData.payload);
        if (workspaceImage) {
          store.upsertProcessedImage(workspaceImage);
        }
        break;
      }
      case 'image-deleted':
        if (eventData.payload?.id) {
          store.removeProcessedImage(eventData.payload.id);
        }
        break;
      case 'animation-settings-changed':
        break;
      case 'audio-updated':
        break;
    }
  }

  private flushPendingEvents(): void {
    if (this.pendingEvents.length === 0) return;
    const queue = [...this.pendingEvents];
    this.pendingEvents = [];
    queue.forEach(event => this.applyDataChange(event));
  }

  /**
   * すべてのイベントリスナーをセットアップ
   */
  async setupListeners(): Promise<void> {
    // 重複登録を避けるため既存リスナーを解除
    if (this.unlisteners.length > 0) {
      this.cleanup();
    }

    this.isHydrating = true;
    await this.updateImageList();
    this.isHydrating = false;
    this.flushPendingEvents();

    // data-changedイベントのリスナー
    const dataChangeUnlisten = await listen<DataChangeEvent>('data-changed', (event) => {
      const eventData = event.payload;
      if (!eventData) return;
      if (this.isHydrating) {
        this.pendingEvents.push(eventData);
        return;
      }
      this.applyDataChange(eventData);
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

      this.isHydrating = true;
      await this.updateImageList();
      this.isHydrating = false;
      this.flushPendingEvents();
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
      const batchSize = 60;
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
