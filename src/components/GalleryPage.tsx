import { useState, useEffect } from 'react';
import { getAllMetadata, loadImage, deleteImage, ImageMetadata } from '../services/imageStorage';
import { loadSettings } from '../services/settings';
import { MovementSettings } from './MovementSettings';
import { getAllMovementSettings, updateMovementSettings } from '../services/movementStorage';
import styles from './GalleryPage.module.scss';

interface GalleryImage extends ImageMetadata {
  thumbnailUrl?: string;
  loading?: boolean;
  // 動き設定
  movementType?: string;
  movementPattern?: string;
  speed?: number;
  size?: string;
}

// 動きの名前マッピング
const movementNames: Record<string, string> = {
  normal: 'ふつう',
  zigzag: 'ジグザグ',
  bounce: 'バウンス',
  circle: '円形',
  wave: '波',
  random: 'ランダム'
};

// サイズの名前マッピング
const sizeNames: Record<string, string> = {
  small: 'ちいさい',
  medium: 'ふつう',
  large: 'おおきい'
};

const typeNames: Record<string, string> = {
  walk: '地上',
  fly: '浮遊',
  swim: '水中'
};

// 値を名前に変換するヘルパー関数
const getMovementName = (value?: string) => value ? (movementNames[value] || value) : '不明';
const getSizeName = (value?: string) => value ? (sizeNames[value] || value) : '不明';
const getTypeName = (value?: string) => value ? (typeNames[value] || value) : '不明';

const formatSpeed = (speed?: number) => {
  if (typeof speed === 'number') {
    return `${Math.round(speed * 100)}%`;
  }
  return '不明';
};

export function GalleryPage() {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'all' | 'edit'>('all');
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [editingImage, setEditingImage] = useState<GalleryImage | null>(null);
  const [tempSettings, setTempSettings] = useState({
    type: 'walk',
    movement: 'normal',
    speed: 0.5,
    size: 'medium'
  });
  const [deletionTime, setDeletionTime] = useState('unlimited');
  const [isDeleting, setIsDeleting] = useState(false);

  // 画像一覧を読み込み
  const loadGalleryImages = async () => {
    setIsLoading(true);
    try {
      const metadata = await getAllMetadata();
      const settings = await loadSettings();
      
      // 画像のみフィルタリング（音声や背景を除外）
      const imageMetadata = metadata.filter(m => 
        m.type === 'original' || m.type === 'processed'
      );
      
      // 新しい順にソート
      imageMetadata.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      // 動き設定を読み込み
      const movementSettingsMap = await getAllMovementSettings();
      
      // サムネイルを非同期で生成
      const galleryImages: GalleryImage[] = imageMetadata.map(m => {
        const movementSettings = movementSettingsMap.get(m.id);
        return { 
          ...m, 
          loading: true,
          movementType: movementSettings?.type || 'walk',
          movementPattern: movementSettings?.movement || 'normal',
          speed: movementSettings?.speed || 0.5,
          size: movementSettings?.size || 'medium'
        };
      });
      setImages(galleryImages);
      
      if (settings?.deletionTime) {
        setDeletionTime(settings.deletionTime);
      }

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

  useEffect(() => {
    loadGalleryImages();
  }, []);

  // 画像を選択/選択解除
  const toggleImageSelection = (imageId: string) => {
    setSelectedImages(prev => {
      const newSelection = new Set(prev);
      if (newSelection.has(imageId)) {
        newSelection.delete(imageId);
      } else {
        newSelection.add(imageId);
      }
      return newSelection;
    });
  };

  // すべて選択/選択解除
  const toggleSelectAll = () => {
    if (selectedImages.size === images.length) {
      setSelectedImages(new Set());
    } else {
      setSelectedImages(new Set(images.map(img => img.id)));
    }
  };

  // 画像を削除
  const handleDeleteImage = async (image: GalleryImage) => {
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

  // 複数画像を一括削除
  const handleBulkDelete = async () => {
    if (selectedImages.size === 0) return;
    
    if (!confirm(`選択した${selectedImages.size}個の画像を削除しますか？`)) {
      return;
    }

    setIsDeleting(true);
    try {
      const imagesToDelete = images.filter(img => selectedImages.has(img.id));
      
      for (const image of imagesToDelete) {
        await deleteImage(image);
      }
      
      setSelectedImages(new Set());
      await loadGalleryImages();
    } catch (error) {
      console.error('一括削除エラー:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  // 編集モーダルを開く
  const openEditModal = (image: GalleryImage) => {
    setEditingImage(image);
    setTempSettings({
      type: image.movementType || 'walk',
      movement: image.movementPattern || 'normal',
      speed: image.speed || 0.5,
      size: image.size || 'medium'
    });
  };

  // 編集を保存
  const saveEdit = async () => {
    if (!editingImage) return;
    
    try {
      // 動き設定を保存
      await updateMovementSettings(editingImage.id, tempSettings);
      
      alert('動き設定を保存しました');
      setEditingImage(null);
      await loadGalleryImages();
    } catch (error) {
      console.error('動き設定の保存エラー:', error);
      alert('動き設定の保存に失敗しました');
    }
  };

  if (isLoading && images.length === 0) {
    return (
      <div className={styles.galleryPage}>
        <h2>お絵描き一覧</h2>
        <p className={styles.loadingText}>読み込み中...</p>
      </div>
    );
  }

  return (
    <div className={styles.galleryPage}>
      <div className={styles.galleryHeader}>
        <h2>お絵描き一覧</h2>
        {selectedImages.size > 0 && (
          <button
            className={styles.bulkDeleteButton}
            onClick={handleBulkDelete}
            disabled={isDeleting}
          >
            {isDeleting ? '削除中...' : `選択した${selectedImages.size}個を削除`}
          </button>
        )}
      </div>

      {/* タブ */}
      <div className={styles.tabContainer}>
        <button
          className={`${styles.tabButton} ${activeTab === 'all' ? styles.active : ''}`}
          onClick={() => setActiveTab('all')}
        >
          すべて表示
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === 'edit' ? styles.active : ''}`}
          onClick={() => setActiveTab('edit')}
        >
          編集モード
        </button>
      </div>

      {/* タブコンテンツ */}
      <div className={styles.tabContent}>
        {activeTab === 'all' ? (
          // すべて表示タブ
          <div className={styles.galleryList}>
            {images.map(image => (
              <div key={image.id} className={styles.imageTile}>
                {image.loading ? (
                  <div className={styles.thumbnailLoading}>
                    <span>読込中...</span>
                  </div>
                ) : (
                  <img
                    src={image.thumbnailUrl || ''}
                    alt={image.originalFileName}
                  />
                )}
                <div className={styles.imageInfo}>
                  <p><strong>{image.originalFileName}</strong></p>
                  <p>タイプ: {getTypeName(image.movementType)}</p>
                  <p>動き: {getMovementName(image.movementPattern)}</p>
                  <p>速度: {formatSpeed(image.speed)}</p>
                  <p>サイズ: {getSizeName(image.size)}</p>
                  <p>アップロード: {new Date(image.createdAt).toLocaleString('ja-JP')}</p>
                </div>
                <div className={styles.imageActions}>
                  <button onClick={() => openEditModal(image)}>編集</button>
                  <button onClick={() => handleDeleteImage(image)}>削除</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          // 編集モードタブ
          <div>
            <div className={styles.editModeHeader}>
              <button
                className={styles.selectAllButton}
                onClick={toggleSelectAll}
              >
                {selectedImages.size === images.length ? '選択解除' : 'すべて選択'}
              </button>
              <p className={styles.selectionInfo}>
                {selectedImages.size}個選択中
              </p>
            </div>
            
            <div className={styles.galleryList}>
              {images.map(image => (
                <div 
                  key={image.id} 
                  className={`${styles.imageTile} ${selectedImages.has(image.id) ? styles.selected : ''}`}
                  onClick={() => toggleImageSelection(image.id)}
                >
                  {selectedImages.has(image.id) && (
                    <div className={styles.checkmark}>✓</div>
                  )}
                  {image.loading ? (
                    <div className={styles.thumbnailLoading}>
                      <span>読込中...</span>
                    </div>
                  ) : (
                    <img
                      src={image.thumbnailUrl || ''}
                      alt={image.originalFileName}
                    />
                  )}
                  <div className={styles.imageInfo}>
                    <p><strong>{image.originalFileName}</strong></p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 編集モーダル */}
      {editingImage && (
        <>
          <div className={styles.modalOverlay} onClick={() => setEditingImage(null)} />
          <div className={styles.editModal}>
            <h3>{editingImage.originalFileName}の編集</h3>
            <MovementSettings
              settings={tempSettings}
              onSettingsChange={setTempSettings}
            />
            <div className={styles.modalActions}>
              <button 
                className={styles.cancelButton}
                onClick={() => setEditingImage(null)}
              >
                キャンセル
              </button>
              <button 
                className={styles.confirmButton}
                onClick={saveEdit}
              >
                保存
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}