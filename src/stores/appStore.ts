import { create } from 'zustand';
import { WorkspaceManager } from '../services/workspaceManager';
import { emit } from '@tauri-apps/api/event';

/**
 * アプリケーションの状態を表す型
 */
export type AppStatus = 'initializing' | 'workspace-needed' | 'ready';

/**
 * アプリケーションストアの型定義
 */
interface AppStore {
  // 状態
  status: AppStatus;
  currentWorkspace: string | null;
  error: string | null;
  
  // アクション
  initialize: () => Promise<void>;
  switchWorkspace: (path: string) => Promise<void>;
  setError: (error: string | null) => void;
}

/**
 * アプリケーション全体の状態を管理するストア
 */
export const useAppStore = create<AppStore>((set, get) => ({
  // 初期状態
  status: 'initializing',
  currentWorkspace: null,
  error: null,

  // 初期化処理（厳密な順序制御）
  initialize: async () => {
    const manager = WorkspaceManager.getInstance();
    
    try {
      // ステップ1: グローバル設定から最後のワークスペースを取得
      let lastWorkspace: string | null = null;
      
      try {
        lastWorkspace = await manager.getLastWorkspace();
      } catch (error) {
        // JSON解析エラーなどは無視して続行
        console.warn('[AppStore] グローバル設定の読み込みエラー（続行）:', error);
      }
      
      if (lastWorkspace) {
        // ステップ2: ワークスペースを開く（DB接続を含む）
        await get().switchWorkspace(lastWorkspace);
      } else {
        // 新規ユーザーの場合
        set({ status: 'workspace-needed' });
      }
    } catch (error) {
      console.error('[AppStore] 初期化エラー:', error);
      set({
        status: 'workspace-needed',
        error: error instanceof Error ? error.message : '初期化に失敗しました'
      });
    }
  },

  // ワークスペース切り替え（DB接続を含む）
  switchWorkspace: async (path: string) => {
    const manager = WorkspaceManager.getInstance();
    
    try {
      set({ status: 'initializing', error: null });
      
      // ワークスペースを切り替え（DB接続を含む）
      await manager.switchWorkspace(path);
      
      // DB接続が完了してから状態を更新
      set({
        status: 'ready',
        currentWorkspace: path,
        error: null
      });
      
      // イベントを発行（他のコンポーネントへの通知用）
      emit('workspace-ready', { path });
    } catch (error) {
      console.error('[AppStore] ワークスペース切り替えエラー:', error);
      set({
        status: 'workspace-needed',
        error: error instanceof Error ? error.message : 'ワークスペースの切り替えに失敗しました'
      });
      throw error;
    }
  },

  // エラー設定
  setError: (error) => set({ error })
}));