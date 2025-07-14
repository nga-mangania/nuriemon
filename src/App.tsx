import { useState, useEffect } from "react";
import { FileUpload } from "./components/FileUpload";
import { ImagePreview } from "./components/ImagePreview";
import { BackgroundRemover } from "./components/BackgroundRemover";
import { ImageGallery } from "./components/ImageGallery";
import { Settings } from "./components/Settings";
import { initializeStorage } from "./services/imageStorage";
import styles from "./App.module.scss";

function App() {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // ストレージを初期化
  useEffect(() => {
    initializeStorage().catch(console.error);
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
        <button 
          className={styles.settingsButton}
          onClick={() => setIsSettingsOpen(true)}
          title="設定"
        >
          ⚙️
        </button>
      </header>
      <main className={styles.main}>
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
