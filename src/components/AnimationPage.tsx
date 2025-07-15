import React, { useState, useEffect } from 'react';
import AnimationView from './AnimationView';
import MovementSettings from './MovementSettings';
import { getAllMetadata, loadImage, ImageMetadata } from '../services/imageStorage';
import { getAllMovementSettings } from '../services/movementStorage';
import styles from './AnimationPage.module.scss';

interface AnimationSettings {
  type: 'walk' | 'fly';
  movement: string;
  size: string;
  speed: number;
}

const AnimationPage: React.FC = () => {
  const [images, setImages] = useState<ImageMetadata[]>([]);
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [animationSettings, setAnimationSettings] = useState<AnimationSettings>({
    type: 'fly',
    movement: 'normal',
    size: 'medium',
    speed: 0.5,
  });
  const [animatedImages, setAnimatedImages] = useState<any[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});

  // 画像一覧を読み込む
  useEffect(() => {
    loadImages();
  }, []);

  const loadImages = async () => {
    try {
      const metadata = await getAllMetadata();
      // 処理済み画像のみフィルタリング
      const processedImages = metadata.filter(img => img.type === 'processed');
      setImages(processedImages);
      
      // 各画像のサムネイルを事前に読み込む
      const newThumbnails: Record<string, string> = {};
      await Promise.all(
        processedImages.map(async (img) => {
          try {
            const imageUrl = await loadImage(img);
            newThumbnails[img.id] = imageUrl;
          } catch (error) {
            console.error('サムネイル読み込みエラー:', error);
          }
        })
      );
      setThumbnails(newThumbnails);
    } catch (error) {
      console.error('画像の読み込みに失敗しました:', error);
    }
  };

  // 画像の選択/選択解除
  const toggleImageSelection = (imageId: string) => {
    const newSelection = new Set(selectedImages);
    if (newSelection.has(imageId)) {
      newSelection.delete(imageId);
    } else {
      newSelection.add(imageId);
    }
    setSelectedImages(newSelection);
  };

  // アニメーションを開始
  const startAnimation = async () => {
    if (selectedImages.size === 0) {
      alert('アニメーションする画像を選択してください');
      return;
    }

    // 動き設定を読み込み
    const movementSettingsMap = await getAllMovementSettings();

    const animatedImagesData = await Promise.all(
      Array.from(selectedImages).map(async (imageId) => {
        const metadata = images.find(img => img.id === imageId);
        if (!metadata) return null;

        try {
          const imageUrl = await loadImage(metadata);
          
          // 保存されている動き設定を取得、なければデフォルト設定を使用
          const savedSettings = movementSettingsMap.get(metadata.id);
          const settings = savedSettings || animationSettings;
          
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
          console.error('画像の読み込みエラー:', error);
          return null;
        }
      })
    );

    const validImages = animatedImagesData.filter(img => img !== null);
    setAnimatedImages(validImages);
    setIsPlaying(true);
  };

  // アニメーションを停止
  const stopAnimation = () => {
    setIsPlaying(false);
    setAnimatedImages([]);
  };

  // 全選択/全解除
  const toggleSelectAll = () => {
    if (selectedImages.size === images.length) {
      setSelectedImages(new Set());
    } else {
      setSelectedImages(new Set(images.map(img => img.id)));
    }
  };

  return (
    <div className={`${styles.animationPage} ${isPlaying ? styles.fullscreen : ''}`}>
      {!isPlaying ? (
        <>
          <div className={styles.imageSelector}>
            <div className={styles.selectorHeader}>
              <h3>画像を選択</h3>
              <button onClick={toggleSelectAll} className={styles.selectAllButton}>
                {selectedImages.size === images.length ? '全解除' : '全選択'}
              </button>
            </div>
            <div className={styles.imageGrid}>
              {images.map(image => (
                <div
                  key={image.id}
                  className={`${styles.imageItem} ${selectedImages.has(image.id) ? styles.selected : ''}`}
                  onClick={() => toggleImageSelection(image.id)}
                >
                  <div className={styles.imageWrapper}>
                    {thumbnails[image.id] ? (
                      <img
                        src={thumbnails[image.id]}
                        alt={image.originalFileName}
                        className={styles.thumbnail}
                      />
                    ) : (
                      <div className={styles.thumbnail}>読み込み中...</div>
                    )}
                    {selectedImages.has(image.id) && (
                      <div className={styles.checkmark}>✓</div>
                    )}
                  </div>
                  <p className={styles.fileName}>{image.originalFileName}</p>
                </div>
              ))}
            </div>
          </div>

          <MovementSettings
            settings={animationSettings}
            onSettingsChange={(newSettings) => setAnimationSettings({ ...animationSettings, ...newSettings })}
          />

          <div className={styles.controls}>
            <button 
              onClick={startAnimation} 
              className={styles.startButton}
              disabled={selectedImages.size === 0}
            >
              アニメーションを始める
            </button>
          </div>
        </>
      ) : (
        <>
          <AnimationView
            images={animatedImages}
            groundPosition={80}
            onImageClick={(imageId) => console.log('画像クリック:', imageId)}
          />
          <div className={styles.controlPanel}>
            <MovementSettings
              settings={animationSettings}
              onSettingsChange={(newSettings) => setAnimationSettings({ ...animationSettings, ...newSettings })}
            />
            <button onClick={stopAnimation} className={styles.stopButton}>
              終了
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default AnimationPage;