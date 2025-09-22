import { useCallback, useEffect, useState } from 'react';
import { getAllMetadata, loadImage } from '../services/imageStorage';
import { downscaleDataUrl } from '../utils/image';
import { getAllMovementSettings } from '../services/movementStorage';
import { listen } from '@tauri-apps/api/event';
import { useWorkspaceStore } from '../stores/workspaceStore';

export const useAnimationData = () => {
  // ストアから状態とアクションを取得
  const { images: storedMetadata, setImages } = useWorkspaceStore();
  const [animatedImages, setAnimatedImages] = useState<any[]>([]);
  const [newImageAdded, setNewImageAdded] = useState(false);
  const [isFirstLoad, setIsFirstLoad] = useState(true);

  // 表示用キャッシュ（起動中のみ）
  const displayUrlCache = (useAnimationData as any)._displayUrlCache || new Map<string, string>();
  (useAnimationData as any)._displayUrlCache = displayUrlCache;

  const transformImageData = async (metadata: any, movementSettingsMap: Map<string, any>) => {
    try {
      // フルサイズを読み込み
      const fullUrl = await loadImage(metadata);
      // 表示用に縮小（キャッシュ）
      let imageUrl = displayUrlCache.get(metadata.id);
      if (!imageUrl) {
        imageUrl = await downscaleDataUrl(fullUrl, 512, 0.8);
        displayUrlCache.set(metadata.id, imageUrl);
      }
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
    const shouldReplaceAnimated = (() => {
      if (animatedImages.length !== validImages.length) return true;
      for (let i = 0; i < validImages.length; i++) {
        const prev = animatedImages[i];
        const next = validImages[i];
        if (!prev || !next) return true;
        if (prev.id !== next.id) return true;
        if (
          prev.type !== next.type ||
          prev.movement !== next.movement ||
          prev.size !== next.size ||
          prev.speed !== next.speed
        ) {
          return true;
        }
      }
      return false;
    })();

    if (shouldReplaceAnimated) {
      setAnimatedImages(validImages);
    }

    const shouldUpdateStore = (() => {
      if (storedMetadata.length !== processedImages.length) return true;
      const prevMap = new Map(storedMetadata.map(img => [img.id, img]));
      for (const img of processedImages) {
        const prev = prevMap.get(img.id);
        if (!prev) return true;
        if (
          (prev as any).updated_at !== (img as any).updated_at ||
          (prev as any).display_started_at !== (img as any).display_started_at ||
          (prev as any).is_hidden !== (img as any).is_hidden ||
          ((prev as any).image_type || (prev as any).type) !== ((img as any).image_type || (img as any).type)
        ) {
          return true;
        }
      }
      return false;
    })();

    if (shouldUpdateStore) {
      setImages(processedImages);
    }
  }, [animatedImages, isFirstLoad, setImages, storedMetadata]);

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
