import { useCallback, useEffect, useState } from 'react';
import { getAllMetadata, loadImage } from '../services/imageStorage';
import { getAllMovementSettings } from '../services/movementStorage';
import { listen } from '@tauri-apps/api/event';
import { useWorkspaceStore } from '../stores/workspaceStore';

export const useAnimationData = () => {
  // ストアから状態とアクションを取得
  const { images: storedMetadata, setImages } = useWorkspaceStore();
  const [animatedImages, setAnimatedImages] = useState<any[]>([]);
  const [newImageAdded, setNewImageAdded] = useState(false);
  const [isFirstLoad, setIsFirstLoad] = useState(true);

  const transformImageData = async (metadata: any, movementSettingsMap: Map<string, any>) => {
    try {
      const imageUrl = await loadImage(metadata);
      const savedSettings = movementSettingsMap.get(metadata.id);
      const settings = savedSettings || {
        type: 'fly',
        movement: 'normal',
        size: 'medium',
        speed: 0.5
      };
      
      // 表示開始時刻（DBのdisplay_started_atがあれば優先）
      const startedAt = (metadata as any).display_started_at ? Date.parse((metadata as any).display_started_at) : Date.now();
      // AnimatedImage型に適合する完全なオブジェクトを作成
      const animatedImage: any = {
        id: metadata.id,
        imageUrl,
        originalFileName: metadata.originalFileName,
        x: 0,
        y: 0,
        velocityX: 0,
        velocityY: 0,
        scale: 1,
        rotation: 0,
        flipped: false,
        type: settings.type || 'fly',
        movement: settings.movement || 'normal',
        size: settings.size || 'medium',
        speed: settings.speed || 0.5,
        directionChangeTimer: 0,
        offset: Math.random() * 1000,
        phaseOffset: Math.random() * Math.PI * 2,
        lastMovementUpdate: Date.now(),
        nextMovementUpdate: Date.now() + 3000 + Math.random() * 2000,
        globalScale: 1,
        scaleDirection: 1,
        scaleSpeed: 0.002,
        animationStartTime: Date.now(),
        isNewImage: false,
        createdAt: startedAt,
      };
      return animatedImage;
    } catch (error) {
      console.error(`Error loading image ${metadata.id}:`, error);
      return null;
    }
  };

  const getProcessedImages = async () => {
    const metadata = await getAllMetadata();
    return metadata.filter(img => {
      const imageType = (img as any).image_type || img.type;
      const hidden = (img as any).is_hidden === 1;
      return imageType === 'processed' && !hidden;
    });
  };

  const updateImages = useCallback(async (isInitialLoad = false) => {
    const processedImages = await getProcessedImages();
    const movementSettingsMap = await getAllMovementSettings();
    
    const animatedImagesData = await Promise.all(
      processedImages.map(img => transformImageData(img, movementSettingsMap))
    );
    
    const validImages = animatedImagesData.filter(img => img !== null);
    
    // 現在の画像IDのセットを作成
    const currentImageIds = new Set(animatedImages.map(img => img.id));
    
    // 新しい画像があるかチェック
    const hasNewImages = validImages.some(img => !currentImageIds.has(img.id));
    
    // 初期ロードでない場合のみ、新規画像の追加を検出
    if (hasNewImages && !isInitialLoad && !isFirstLoad) {
      setNewImageAdded(true);
    }
    
    // 初回ロードフラグをリセット
    if (isFirstLoad) {
      setIsFirstLoad(false);
    }
    
    // AnimatedImage型のデータをローカルステートに保存
    setAnimatedImages(validImages);
    
    // メタデータのみをZustandストアに保存
    setImages(processedImages);
  }, [isFirstLoad, animatedImages, setImages]);

  // バックエンドからの更新通知をリッスン
  useEffect(() => {
    const unlistenPromise = listen('image-list-updated', () => {
      console.log('[useAnimationData] Image list update event received.');
      updateImages();
    });

    return () => {
      unlistenPromise
        .then(unlisten => { try { unlisten(); } catch (_) {} })
        .catch(() => {});
    };
  }, [updateImages]);

  // 初回ロード時にストアのメタデータから画像を復元
  useEffect(() => {
    if (storedMetadata.length > 0 && animatedImages.length === 0) {
      updateImages(true);
    }
  }, [storedMetadata, animatedImages.length, updateImages]);

  return {
    animatedImages, // ローカルステートから返す
    updateImages,
    newImageAdded,
    setNewImageAdded,
  };
};
