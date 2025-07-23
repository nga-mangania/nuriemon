import { useState, useEffect } from "react";
import { Settings } from "./components/Settings";
import { UploadPage } from "./components/UploadPage";
import { GalleryPage } from "./components/GalleryPage";
import { SettingsPage } from "./components/SettingsPage";
import { initializeStorage } from "./services/imageStorage";
import { startAutoDeleteService } from "./services/autoDelete";
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useWorkspace } from "./hooks/useWorkspace";
import { WorkspaceSelector } from "./components/WorkspaceSelector";
import styles from "./App.module.scss";

function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'settings' | 'upload' | 'gallery' | 'animation'>('upload');
  const { currentWorkspace } = useWorkspace();

  // ワークスペースが選択されたら初期化
  useEffect(() => {
    if (currentWorkspace) {
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
  }, [currentWorkspace]);

  const handleSettingsSaved = () => {
    // 設定が変更されたらストレージを再初期化
    initializeStorage().catch(console.error);
  };

  return (
    <>
      <WorkspaceSelector />
      <div className={styles.container}>
        <header className={styles.header}>
        <h1 className={styles.title}>ぬりえもん</h1>
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${activeTab === 'settings' ? styles.active : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            初期設定
          </button>
          <button
            className={`${styles.tab} ${activeTab === 'upload' ? styles.active : ''}`}
            onClick={() => setActiveTab('upload')}
          >
            アップロード
          </button>
          <button
            className={`${styles.tab} ${activeTab === 'gallery' ? styles.active : ''}`}
            onClick={() => setActiveTab('gallery')}
          >
            ギャラリー
          </button>
          <button
            className={`${styles.tab} ${activeTab === 'animation' ? styles.active : ''}`}
            onClick={async () => {
              console.log('[DEBUG] アニメーションタブがクリックされました');
              try {
                // 既存のアニメーションウィンドウがあるか確認
                console.log('[DEBUG] 既存のウィンドウを確認中...');
                const existingWindow = await WebviewWindow.getByLabel('animation');
                console.log('[DEBUG] 既存のウィンドウ:', existingWindow);
                
                if (existingWindow) {
                  // 既存のウィンドウをフォーカス
                  console.log('[DEBUG] 既存のウィンドウにフォーカスします');
                  await existingWindow.setFocus();
                } else {
                  // 新しいウィンドウを作成
                  console.log('[DEBUG] 新しいウィンドウを作成します');
                  const animationWindow = new WebviewWindow('animation', {
                    url: '#/animation',
                    title: 'ぬりえもん - アニメーション',
                    width: 1024,
                    height: 768,
                    resizable: true,
                    decorations: true,
                    devtools: true,  // 開発者ツールを有効化
                  });
                  
                  console.log('[DEBUG] ウィンドウ作成完了:', animationWindow);
                  
                  // ウィンドウが作成されたらメインウィンドウをアップロードタブに戻す
                  animationWindow.once('tauri://created', async () => {
                    console.log('[DEBUG] ウィンドウが正常に作成されました');
                    // 開発環境の場合、自動的に開発者ツールを開く
                    if (import.meta.env.DEV) {
                      try {
                        // @ts-ignore
                        await animationWindow.openDevtools();
                        console.log('[DEBUG] アニメーションウィンドウの開発者ツールを開きました');
                      } catch (e) {
                        console.log('[DEBUG] 開発者ツールの自動オープンに失敗（手動で開いてください）');
                      }
                    }
                    setActiveTab('upload');
                  });
                  
                  // エラーイベントも監視
                  animationWindow.once('tauri://error', (error) => {
                    console.error('[DEBUG] ウィンドウ作成エラー:', error);
                  });
                }
              } catch (error) {
                console.error('[DEBUG] アニメーションウィンドウの操作エラー:', error);
                console.error('[DEBUG] エラーの詳細:', {
                  message: error instanceof Error ? error.message : '不明なエラー',
                  stack: error instanceof Error ? error.stack : undefined
                });
              }
            }}
          >
            アニメーション
          </button>
        </div>
        <button 
          className={styles.settingsButton}
          onClick={() => setIsSettingsOpen(true)}
          title="設定"
        >
          ⚙️
        </button>
      </header>
      <main className={`${styles.main} ${styles.fullWidth}`}>
        {activeTab === 'settings' && (
          <SettingsPage />
        )}
        {activeTab === 'upload' && (
          <UploadPage />
        )}
        {activeTab === 'gallery' && (
          <GalleryPage />
        )}
      </main>
      
      <Settings
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSettingsSaved}
      />
      </div>
    </>
  );
}

export default App;
