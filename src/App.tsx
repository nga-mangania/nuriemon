import { useState } from "react";
import { FileUpload } from "./components/FileUpload";
import { ImagePreview } from "./components/ImagePreview";
import styles from "./App.module.scss";

function App() {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  const handleImageSelect = (imageData: string, fileName: string) => {
    setSelectedImage(imageData);
    setSelectedFileName(fileName);
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>ぬりえもん</h1>
      </header>
      <main className={styles.main}>
        <FileUpload onImageSelect={handleImageSelect} />
        <ImagePreview imageData={selectedImage} fileName={selectedFileName} />
      </main>
    </div>
  );
}

export default App;
