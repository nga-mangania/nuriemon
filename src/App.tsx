import { useState, useEffect } from "react";
import { FileUpload } from "./components/FileUpload";
import { ImagePreview } from "./components/ImagePreview";
import { SavedImages } from "./components/SavedImages";
import { initializeStorage } from "./services/imageStorage";
import styles from "./App.module.scss";

function App() {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

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

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>ぬりえもん</h1>
      </header>
      <main className={styles.main}>
        <FileUpload 
          onImageSelect={handleImageSelect}
          onImageSaved={handleImageSaved}
        />
        <ImagePreview imageData={selectedImage} fileName={selectedFileName} />
        <SavedImages 
          onImageLoad={handleImageSelect}
          refreshTrigger={refreshTrigger}
        />
      </main>
    </div>
  );
}

export default App;
