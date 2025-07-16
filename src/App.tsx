import { useState, useEffect } from "react";
import { Settings } from "./components/Settings";
import AnimationPage from "./components/AnimationPage";
import { UploadPage } from "./components/UploadPage";
import { GalleryPage } from "./components/GalleryPage";
import { initializeStorage } from "./services/imageStorage";
import { startAutoDeleteService } from "./services/autoDelete";
import styles from "./App.module.scss";

function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'upload' | 'gallery' | 'animation'>('upload');

  // ストレージを初期化と自動削除サービスを開始
  useEffect(() => {
    initializeStorage().catch(console.error);
    startAutoDeleteService();
  }, []);

  const handleSettingsSaved = () => {
    // 設定が変更されたらストレージを再初期化
    initializeStorage().catch(console.error);
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>ぬりえもん</h1>
        <div className={styles.tabs}>
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
            onClick={() => setActiveTab('animation')}
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
        {activeTab === 'upload' && (
          <UploadPage />
        )}
        {activeTab === 'gallery' && (
          <GalleryPage />
        )}
        {activeTab === 'animation' && (
          <AnimationPage />
        )}
      </main>
      
      <Settings
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSettingsSaved}
      />
    </div>
  );
}

export default App;
