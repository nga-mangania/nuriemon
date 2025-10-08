import { useState, useEffect } from 'react';
import { confirm as tauriConfirm } from '@tauri-apps/plugin-dialog';
import { getAllMetadata, loadImage, deleteImage, ImageMetadata } from '../services/imageStorage';
import { MovementSettings } from './MovementSettings';
import { getAllMovementSettings, updateMovementSettings } from '../services/movementStorage';
import styles from './GalleryPage.module.scss';
import { useWorkspaceStore } from '../stores/workspaceStore';

interface GalleryImage extends Omit<ImageMetadata, 'size'> {
  thumbnailUrl?: string;
  loading?: boolean;
  // 動き設定
  movementType?: string;
  movementPattern?: string;
  speed?: number;
  movementSize?: string;
  size: number; // ImageMetadataのsizeプロパティ
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

function renderRemaining(image: any, deletionTime: string) {
  if (deletionTime === 'unlimited') return '無制限';
  const minutes = parseInt(deletionTime);
  if (!minutes || isNaN(minutes)) return '無制限';
  const started = (image as any).display_started_at ? Date.parse((image as any).display_started_at) : undefined;
  if (!started) return '未表示';
  const deadline = started + minutes * 60 * 1000;
  const left = Math.max(0, deadline - Date.now());
  const mm = Math.floor(left / 60000);
  const ss = Math.floor((left % 60000) / 1000);
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

export function GalleryPage() {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingImage, setEditingImage] = useState<GalleryImage | null>(null);
  const [tempSettings, setTempSettings] = useState({
    type: 'walk',
    movement: 'normal',
    speed: 0.5,
    size: 'medium'
  });
  const [isDeleting, setIsDeleting] = useState(false);
  const { deletionTime } = useWorkspaceStore();
  const [tick, setTick] = useState(0);
  // mark as read to satisfy TS
  void tick;

  useEffect(() => {
    const t = setInterval(() => setTick(v => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // ギャラリーは処理済み画像のみ表示
  const getFilteredImages = () => images.filter(img => img.type === 'processed');

  // 画像一覧を読み込み
  const loadGalleryImages = async () => {
    setIsLoading(true);
    try {
      const metadata = await getAllMetadata();
      
      // 画像のみフィルタリング（音声や背景を除外）
      const imageMetadata = metadata.filter(m => {
        // image_typeプロパティがある場合はそれを使用
        const imageType = (m as any).image_type || m.type;
        return imageType === 'processed';
      });
      
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
          movementSize: movementSettings?.size || 'medium'
        };
      });
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

  // 画像を削除
  const handleDeleteImage = async (image: GalleryImage) => {
    const confirmed = await tauriConfirm(`"${image.originalFileName}" を削除しますか？`, {
      title: '削除の確認'
    });
    
    if (!confirmed) {
      return;
    }

    try {
      await deleteImage(image);
      await loadGalleryImages();
    } catch (error) {
      console.error('画像削除エラー:', error);
      alert('画像の削除に失敗しました');
    }
  };

  // ギャラリー全削除
  const handleBulkDelete = async () => {
    const imagesToDelete = images.filter(img => img.type === 'processed');
    if (imagesToDelete.length === 0) {
      console.log('[GalleryPage] 全削除対象なし');
      return;
    }

    const confirmed = await tauriConfirm('ギャラリー内のすべての画像を削除しますか？', {
      title: '全削除の確認'
    });

    console.log('[GalleryPage] 全削除確認', { confirmed, count: imagesToDelete.length });
    if (!confirmed) {
      return;
    }

    setIsDeleting(true);
    try {
      console.log('[GalleryPage] 全削除開始', imagesToDelete.map(img => img.id));
      for (const image of imagesToDelete) {
        await deleteImage(image);
      }
      console.log('[GalleryPage] 全削除完了');
      await loadGalleryImages();
    } catch (error) {
      console.error('全削除エラー:', error);
      alert('画像の削除に失敗しました');
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
      size: image.movementSize || 'medium'
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
        <button
          className={styles.bulkDeleteButton}
          onClick={handleBulkDelete}
          disabled={isDeleting || getFilteredImages().length === 0}
        >
          {isDeleting ? '削除中...' : '全削除'}
        </button>
      </div>

      <div className={styles.galleryContent}>
        <div className={styles.galleryList}>
          {getFilteredImages().map(image => (
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
                <p>サイズ: {getSizeName(image.movementSize)}</p>
                <p className={styles.remainingTime}>残り: {renderRemaining(image, deletionTime)}</p>
                <p>アップロード: {new Date(image.createdAt).toLocaleString('ja-JP')}</p>
              </div>
              <div className={styles.imageActions}>
                <button className={styles.editButton} onClick={() => openEditModal(image)}>編集</button>
                <button onClick={() => handleDeleteImage(image)}>削除</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 編集モーダル */}
      {editingImage && (
        <>
          <div className={styles.modalOverlay} onClick={() => setEditingImage(null)} />
          <div className={styles.editModal}>
            <h3>{editingImage.originalFileName}の編集</h3>
            <MovementSettings
              settings={{
                type: tempSettings.type as 'walk' | 'fly',
                movement: tempSettings.movement,
                speed: tempSettings.speed,
                size: tempSettings.size
              }}
              onSettingsChange={(newSettings) => {
                setTempSettings(prev => ({
                  ...prev,
                  ...newSettings
                }));
              }}
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
