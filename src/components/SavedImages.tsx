import { useState, useEffect } from 'react';
import { getAllMetadata, loadImage, deleteImage, ImageMetadata } from '../services/imageStorage';
import styles from './SavedImages.module.scss';

interface SavedImagesProps {
  onImageLoad?: (imageData: string, fileName: string) => void;
  refreshTrigger?: number;
}

export function SavedImages({ onImageLoad, refreshTrigger }: SavedImagesProps) {
  const [savedImages, setSavedImages] = useState<ImageMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingImages, setLoadingImages] = useState<Set<string>>(new Set());

  // 保存済み画像を読み込む
  const loadSavedImages = async () => {
    setIsLoading(true);
    try {
      const metadata = await getAllMetadata();
      // 新しい順に並び替え
      metadata.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setSavedImages(metadata);
    } catch (error) {
      console.error('保存済み画像の読み込みエラー:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // 初回読み込みとリフレッシュトリガー
  useEffect(() => {
    loadSavedImages();
  }, [refreshTrigger]);

  // 画像を表示
  const handleLoadImage = async (metadata: ImageMetadata) => {
    setLoadingImages(prev => new Set(prev).add(metadata.id));
    try {
      const imageData = await loadImage(metadata);
      if (onImageLoad) {
        onImageLoad(imageData, metadata.originalFileName);
      }
    } catch (error) {
      console.error('画像読み込みエラー:', error);
      alert('画像の読み込みに失敗しました');
    } finally {
      setLoadingImages(prev => {
        const newSet = new Set(prev);
        newSet.delete(metadata.id);
        return newSet;
      });
    }
  };

  // 画像を削除
  const handleDeleteImage = async (metadata: ImageMetadata) => {
    if (!confirm(`"${metadata.originalFileName}" を削除しますか？`)) {
      return;
    }

    try {
      await deleteImage(metadata);
      await loadSavedImages(); // リスト更新
    } catch (error) {
      console.error('画像削除エラー:', error);
      alert('画像の削除に失敗しました');
    }
  };

  if (isLoading) {
    return (
      <div className={styles.savedImages}>
        <h3 className={styles.title}>保存済み画像</h3>
        <p className={styles.loadingText}>読み込み中...</p>
      </div>
    );
  }

  if (savedImages.length === 0) {
    return (
      <div className={styles.savedImages}>
        <h3 className={styles.title}>保存済み画像</h3>
        <p className={styles.emptyText}>保存された画像はありません</p>
      </div>
    );
  }

  return (
    <div className={styles.savedImages}>
      <h3 className={styles.title}>保存済み画像 ({savedImages.length}件)</h3>
      <div className={styles.imageList}>
        {savedImages.map(metadata => (
          <div key={metadata.id} className={styles.imageItem}>
            <div className={styles.imageInfo}>
              <p className={styles.fileName}>{metadata.originalFileName}</p>
              <p className={styles.meta}>
                {new Date(metadata.createdAt).toLocaleString('ja-JP')}
                {metadata.width && metadata.height && (
                  <span> • {metadata.width}x{metadata.height}</span>
                )}
                <span> • {(metadata.size / 1024).toFixed(1)}KB</span>
              </p>
            </div>
            <div className={styles.actions}>
              <button
                className={styles.loadButton}
                onClick={() => handleLoadImage(metadata)}
                disabled={loadingImages.has(metadata.id)}
              >
                {loadingImages.has(metadata.id) ? '読込中...' : '表示'}
              </button>
              <button
                className={styles.deleteButton}
                onClick={() => handleDeleteImage(metadata)}
              >
                削除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}