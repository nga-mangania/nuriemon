import { useState, useCallback, useEffect } from 'react';
import { getAllMetadata, loadImage } from '../services/imageStorage';
import { getAllMovementSettings } from '../services/movementStorage';
import { listen } from '@tauri-apps/api/event';

export const useAnimationData = () => {
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
      
      return {
        id: metadata.id,
        imageUrl,
        originalFileName: metadata.originalFileName,
        type: settings.type,
        movement: settings.movement,
        size: settings.size,
        speed: settings.speed,
      };
    } catch (error) {
      console.error(`Error loading image ${metadata.id}:`, error);
      return null;
    }
  };

  const getProcessedImages = async () => {
    const metadata = await getAllMetadata();
    return metadata.filter(img => {
      const imageType = (img as any).image_type || img.type;
      return imageType === 'processed';
    });
  };

  const updateImages = useCallback(async (isInitialLoad = false) => {
    const processedImages = await getProcessedImages();
    const movementSettingsMap = await getAllMovementSettings();
    
    const animatedImagesData = await Promise.all(
      processedImages.map(img => transformImageData(img, movementSettingsMap))
    );
    
    const validImages = animatedImagesData.filter(img => img !== null);
    
    setAnimatedImages(prevImages => {
      // 現在の画像IDのセットを作成
      const currentImageIds = new Set(prevImages.map(img => img.id));
      
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
      
      return validImages;
    });
  }, [isFirstLoad]);

  // バックエンドからの更新通知をリッスン
  useEffect(() => {
    const unlistenPromise = listen('image-list-updated', () => {
      console.log('[useAnimationData] Image list update event received.');
      updateImages();
    });

    return () => {
      unlistenPromise.then(unlisten => unlisten());
    };
  }, [updateImages]);

  return {
    animatedImages,
    updateImages,
    newImageAdded,
    setNewImageAdded,
  };
};
