import { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import { WorkspaceManager } from '../services/workspaceManager';

/**
 * ワークスペース管理フック（シンプル化版）
 * Zustandストアのラッパーとして機能
 */
export function useWorkspace() {
  const { status, currentWorkspace, error, initialize, switchWorkspace } = useAppStore();
  const initializeRef = useRef(false);

  // 初回マウント時に一度だけ初期化
  useEffect(() => {
    if (!initializeRef.current && status === 'initializing') {
      initializeRef.current = true;
      initialize();
    }
  }, [initialize, status]);

  return {
    // 状態
    currentWorkspace,
    isLoading: status === 'initializing',
    needsWorkspace: status === 'workspace-needed',
    isReady: status === 'ready',
    error,
    
    // アクション
    switchWorkspace,
    manager: WorkspaceManager.getInstance()
  };
}
