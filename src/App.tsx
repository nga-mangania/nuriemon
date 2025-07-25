import { useState, useEffect } from "react";
import { UploadPage } from "./components/UploadPage";
import { GalleryPage } from "./components/GalleryPage";
import { SettingsPage } from "./components/SettingsPage";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { initializeStorage } from "./services/imageStorage";
import { startAutoDeleteService } from "./services/autoDelete";
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useWorkspace } from "./hooks/useWorkspace";
import { WorkspaceSelector } from "./components/WorkspaceSelector";
import styles from "./App.module.scss";

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
  const [activeTab, setActiveTab] = useState<'settings' | 'upload' | 'gallery' | 'animation'>('upload');
  const { isLoading, needsWorkspace, isReady, currentWorkspace } = useWorkspace();

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
          await initializeStorage();
          startAutoDeleteService();
        } catch (error) {
          console.error('初期化エラー:', error);
        }
      };
      
      initialize();
    }
  }, [isReady, currentWorkspace]);

  const handleAnimationClick = async () => {
    try {
      // 既存のアニメーションウィンドウがあるか確認
      const existingWindow = await WebviewWindow.getByLabel('animation');
      
      if (existingWindow) {
        // 既存のウィンドウをフォーカス
        await existingWindow.setFocus();
      } else {
        // 新しいウィンドウを作成
        const animationWindow = new WebviewWindow('animation', {
          url: '#/animation',
          title: 'ぬりえもん - アニメーション',
          width: 1024,
          height: 768,
          resizable: true,
          decorations: true,
        });
        
        // ウィンドウが作成されたらメインウィンドウをアップロードタブに戻す
        animationWindow.once('tauri://created', () => {
          setActiveTab('upload');
        });
      }
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

export default App;