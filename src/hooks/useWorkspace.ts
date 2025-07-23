import { useEffect, useState } from 'react';
import { WorkspaceManager } from '../services/workspaceManager';
import { listen } from '@tauri-apps/api/event';

/**
 * ワークスペース管理フック
 */
export function useWorkspace() {
  const [currentWorkspace, setCurrentWorkspace] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const manager = WorkspaceManager.getInstance();

  useEffect(() => {
    // ワークスペース変更イベントをリスン
    const unsubscribe = listen('workspace-changed', (event) => {
      const { path } = event.payload as { path: string };
      setCurrentWorkspace(path);
    });

    // 初期化
    initializeWorkspace();

    return () => {
      unsubscribe.then(fn => fn());
    };
  }, []);

  const initializeWorkspace = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // 最後に使用したワークスペースを取得
      const lastWorkspace = await manager.getLastWorkspace();
      
      if (lastWorkspace) {
        // 既存のワークスペースを開く
        await switchWorkspace(lastWorkspace);
      } else {
        // 新規ユーザーの場合
        setIsLoading(false);
      }
    } catch (err) {
      console.error('[useWorkspace] 初期化エラー:', err);
      setError(err instanceof Error ? err.message : '初期化に失敗しました');
      setIsLoading(false);
    }
  };

  const switchWorkspace = async (path: string, onProgress?: (message: string) => void) => {
    try {
      setIsLoading(true);
      setError(null);
      
      await manager.switchWorkspace(path, onProgress);
      setCurrentWorkspace(path);
    } catch (err) {
      console.error('[useWorkspace] ワークスペース切り替えエラー:', err);
      setError(err instanceof Error ? err.message : 'ワークスペースの切り替えに失敗しました');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    currentWorkspace,
    isLoading,
    error,
    switchWorkspace,
    manager
  };
}