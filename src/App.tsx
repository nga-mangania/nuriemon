import { useState, useEffect } from "react";
import { UploadPage } from "./components/UploadPage";
import { GalleryPage } from "./components/GalleryPage";
import { SettingsPage } from "./components/SettingsPage";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { initializeStorage } from "./services/imageStorage";
import { startAutoDeleteService, stopAutoDeleteService } from "./services/autoDelete";
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useWorkspace } from "./hooks/useWorkspace";
import { WorkspaceSelector } from "./components/WorkspaceSelector";
import { TauriEventListener } from "./events/tauriEventListener";
import { rehydrateStore, saveStateToFile, useWorkspaceStore } from "./stores/workspaceStore";
import { emit } from '@tauri-apps/api/event';
import styles from "./App.module.scss";

console.log('[App.tsx] Module loaded');

// 初期ローディング画面を非表示にする
function hideInitialLoading() {
  const loadingElement = document.getElementById('initial-loading');
  if (loadingElement) {
    loadingElement.classList.add('hidden');
    // アニメーション完了後に完全に削除
    setTimeout(() => {
      loadingElement.style.display = 'none';
    }, 300);
  }
}

function App() {
  console.log('[App] Component rendering');
  const [activeTab, setActiveTab] = useState<'settings' | 'upload' | 'gallery' | 'animation'>('upload');
  const { isLoading, needsWorkspace, isReady, currentWorkspace } = useWorkspace();
  
  console.log('[App] State:', { isLoading, needsWorkspace, isReady, currentWorkspace });

  // 状態に基づいて初期ローディング画面を制御
  useEffect(() => {
    // 初期化が完了したら必ず初期ローディング画面を非表示
    if (!isLoading) {
      // 即座に非表示にする（遅延を最小限に）
      requestAnimationFrame(() => {
        hideInitialLoading();
      });
    }
  }, [isLoading]);

  // ワークスペースが準備できたら初期化
  useEffect(() => {
    if (isReady && currentWorkspace) {
      const initialize = async () => {
        try {
          // ストアを再水和
          await rehydrateStore();
          await initializeStorage();
          startAutoDeleteService();
          
          // Tauriイベントリスナーをセットアップ
          const eventListener = TauriEventListener.getInstance();
          await eventListener.setupListeners();
          console.log('[App] Tauriイベントリスナーをセットアップしました');
        } catch (error) {
          console.error('初期化エラー:', error);
        }
      };
      
      initialize();
      
      // クリーンアップ
      return () => {
        const eventListener = TauriEventListener.getInstance();
        eventListener.cleanup();
      };
    }
  }, [isReady, currentWorkspace]);

  // ワークスペース変更時に自動削除サービスを再起動
  useEffect(() => {
    if (!isReady) return;

    const setupWorkspaceListener = async () => {
      const unlisten = await listen('workspace-data-loaded', async (_event) => {
        console.log('[App] ワークスペース変更検出、自動削除サービスを再起動します');
        
        // 既存の自動削除サービスを停止
        stopAutoDeleteService();
        
        // ストレージを再初期化
        try {
          await initializeStorage();
          // 自動削除サービスを再起動
          startAutoDeleteService();
          console.log('[App] 自動削除サービスを再起動しました');
        } catch (error) {
          console.error('[App] 自動削除サービスの再起動エラー:', error);
        }
      });

      return () => {
        unlisten();
      };
    };

    const cleanupPromise = setupWorkspaceListener();

    return () => {
      cleanupPromise.then(cleanup => cleanup && cleanup());
    };
  }, [isReady]);

  const handleAnimationClick = async () => {
    try {
      // Rustコマンドを使用してアニメーションウィンドウを開く
      await invoke('open_animation_window');
      // メインウィンドウをアップロードタブに戻す
      setActiveTab('upload');
    } catch (error) {
      console.error('アニメーションウィンドウの操作エラー:', error);
    }
  };

  // 初期化中は何も表示しない（HTMLのローディング画面が表示される）
  if (isLoading) {
    return null;
  }

  // ワークスペース選択が必要な場合
  if (needsWorkspace) {
    return <WorkspaceSelector />;
  }


  // 準備完了したらメインUIを表示
  if (isReady) {
    return (
      <div className={styles.appLayout}>
        <Sidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onAnimationClick={handleAnimationClick}
        />
        
        <main className={styles.mainContent}>
          {activeTab === 'settings' && <SettingsPage />}
          {activeTab === 'upload' && <UploadPage />}
          {activeTab === 'gallery' && <GalleryPage />}
        </main>
      </div>
    );
  }

  // フォールバック（通常は到達しない）
  return null;
}

// Zustandストアの変更を監視して他のウィンドウに通知
useWorkspaceStore.subscribe(
  (state) => state.images,
  (images) => {
    console.log('[App] Images changed in store, emitting store-updated event');
    // 画像リストが変更されたら他のウィンドウに通知
    emit('store-updated');
  }
);

export default App;