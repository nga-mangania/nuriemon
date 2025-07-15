import { useState, useEffect } from "react";
import { FileUpload } from "./components/FileUpload";
import { ImagePreview } from "./components/ImagePreview";
import { BackgroundRemover } from "./components/BackgroundRemover";
import { ImageGallery } from "./components/ImageGallery";
import { Settings } from "./components/Settings";
import AnimationPage from "./components/AnimationPage";
import { UploadPage } from "./components/UploadPage";
import { GalleryPage } from "./components/GalleryPage";
import { initializeStorage } from "./services/imageStorage";
import { startAutoDeleteService } from "./services/autoDelete";
import styles from "./App.module.scss";

function App() {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'upload' | 'edit' | 'gallery' | 'animation'>('upload');

  // ストレージを初期化と自動削除サービスを開始
  useEffect(() => {
    initializeStorage().catch(console.error);
    startAutoDeleteService();
  }, []);

  const handleImageSelect = (imageData: string, fileName: string) => {
    setSelectedImage(imageData);
    setSelectedFileName(fileName);
  };

  const handleImageSaved = () => {
    // 保存済み画像リストを更新
    setRefreshTrigger(prev => prev + 1);
  };

  const handleSettingsSaved = () => {
    // 設定が変更されたらストレージを再初期化
    initializeStorage().catch(console.error);
    setRefreshTrigger(prev => prev + 1);
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
            className={`${styles.tab} ${activeTab === 'edit' ? styles.active : ''}`}
            onClick={() => setActiveTab('edit')}
          >
            画像編集
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
      <main className={`${styles.main} ${activeTab === 'edit' ? styles.twoColumn : styles.fullWidth}`}>
        {activeTab === 'upload' && (
          <UploadPage />
        )}
        {activeTab === 'edit' && (
          <>
            <div className={styles.leftColumn}>
              <FileUpload 
                onImageSelect={handleImageSelect}
                onImageSaved={handleImageSaved}
              />
              <ImagePreview imageData={selectedImage} fileName={selectedFileName} />
              <BackgroundRemover
                imageData={selectedImage}
                fileName={selectedFileName}
                onProcessed={handleImageSelect}
                onSaved={handleImageSaved}
              />
            </div>
            <div className={styles.rightColumn}>
              <ImageGallery 
                onImageSelect={handleImageSelect}
                refreshTrigger={refreshTrigger}
              />
            </div>
          </>
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
