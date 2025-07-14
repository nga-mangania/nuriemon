import { useState, useEffect } from 'react';
import { getAllMetadata, loadImage, deleteImage, ImageMetadata } from '../services/imageStorage';
import styles from './ImageGallery.module.scss';

interface ImageGalleryProps {
  onImageSelect?: (imageData: string, fileName: string) => void;
  refreshTrigger?: number;
}

interface GalleryImage extends ImageMetadata {
  thumbnailUrl?: string;
  loading?: boolean;
}

export function ImageGallery({ onImageSelect, refreshTrigger }: ImageGalleryProps) {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'original' | 'processed'>('all');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  // サムネイルを生成
  const generateThumbnail = async (metadata: ImageMetadata): Promise<string> => {
    try {
      const fullImage = await loadImage(metadata);
      
      // Canvas でサムネイルを生成
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = fullImage;
      });

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context not available');

      // サムネイルサイズ
      const maxSize = 200;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxSize) {
          height = (height * maxSize) / width;
          width = maxSize;
        }
      } else {
        if (height > maxSize) {
          width = (width * maxSize) / height;
          height = maxSize;
        }
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      return canvas.toDataURL('image/jpeg', 0.8);
    } catch (error) {
      console.error('サムネイル生成エラー:', error);
      return '';
    }
  };

  // 画像一覧を読み込み
  const loadGalleryImages = async () => {
    setIsLoading(true);
    try {
      const metadata = await getAllMetadata();
      
      // 新しい順にソート
      metadata.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      // サムネイルを非同期で生成
      const galleryImages: GalleryImage[] = metadata.map(m => ({ ...m, loading: true }));
      setImages(galleryImages);

      // サムネイルを順次生成
      for (let i = 0; i < galleryImages.length; i++) {
        const thumbnail = await generateThumbnail(galleryImages[i]);
        setImages(prev => prev.map((img, idx) => 
          idx === i ? { ...img, thumbnailUrl: thumbnail, loading: false } : img
        ));
      }
    } catch (error) {
      console.error('ギャラリー読み込みエラー:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadGalleryImages();
  }, [refreshTrigger]);

  // フィルタリングされた画像
  const filteredImages = images.filter(img => {
    if (filter === 'all') return true;
    return img.type === filter;
  });

  // 画像を選択
  const handleImageClick = async (image: GalleryImage) => {
    try {
      const fullImage = await loadImage(image);
      setSelectedImage(image.id);
      if (onImageSelect) {
        onImageSelect(fullImage, image.originalFileName);
      }
    } catch (error) {
      console.error('画像読み込みエラー:', error);
    }
  };

  // 画像を削除
  const handleDeleteImage = async (e: React.MouseEvent, image: GalleryImage) => {
    e.stopPropagation();
    if (!confirm(`"${image.originalFileName}" を削除しますか？`)) {
      return;
    }

    try {
      await deleteImage(image);
      await loadGalleryImages();
    } catch (error) {
      console.error('画像削除エラー:', error);
    }
  };

  if (isLoading && images.length === 0) {
    return (
      <div className={styles.gallery}>
        <h3 className={styles.title}>ギャラリー</h3>
        <p className={styles.loadingText}>読み込み中...</p>
      </div>
    );
  }

  return (
    <div className={styles.gallery}>
      <div className={styles.header}>
        <h3 className={styles.title}>ギャラリー</h3>
        <div className={styles.filters}>
          <button
            className={`${styles.filterButton} ${filter === 'all' ? styles.active : ''}`}
            onClick={() => setFilter('all')}
          >
            すべて ({images.length})
          </button>
          <button
            className={`${styles.filterButton} ${filter === 'original' ? styles.active : ''}`}
            onClick={() => setFilter('original')}
          >
            オリジナル ({images.filter(i => i.type === 'original').length})
          </button>
          <button
            className={`${styles.filterButton} ${filter === 'processed' ? styles.active : ''}`}
            onClick={() => setFilter('processed')}
          >
            処理済み ({images.filter(i => i.type === 'processed').length})
          </button>
        </div>
      </div>

      {filteredImages.length === 0 ? (
        <p className={styles.emptyText}>
          {filter === 'all' ? '画像がありません' : `${filter === 'original' ? 'オリジナル' : '処理済み'}画像がありません`}
        </p>
      ) : (
        <div className={styles.grid}>
          {filteredImages.map(image => (
            <div
              key={image.id}
              className={`${styles.imageCard} ${selectedImage === image.id ? styles.selected : ''}`}
              onClick={() => handleImageClick(image)}
            >
              {image.loading ? (
                <div className={styles.thumbnailLoading}>
                  <span>読込中...</span>
                </div>
              ) : (
                <img
                  src={image.thumbnailUrl || ''}
                  alt={image.originalFileName}
                  className={styles.thumbnail}
                />
              )}
              <div className={styles.imageInfo}>
                <p className={styles.fileName}>{image.originalFileName}</p>
                <p className={styles.meta}>
                  {new Date(image.createdAt).toLocaleDateString('ja-JP')}
                  {image.type === 'processed' && (
                    <span className={styles.badge}>処理済み</span>
                  )}
                </p>
              </div>
              <button
                className={styles.deleteButton}
                onClick={(e) => handleDeleteImage(e, image)}
                title="削除"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}