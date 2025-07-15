import React, { useState, useEffect } from 'react';
import AnimationView from './AnimationView';
import MovementSettings from './MovementSettings';
import { getAllMetadata, loadImage, ImageMetadata } from '../services/imageStorage';
import { getAllMovementSettings } from '../services/movementStorage';
import { loadSettings } from '../services/settings';
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
  const [groundPosition, setGroundPosition] = useState(80);
  const [bgmUrl, setBgmUrl] = useState<string | null>(null);
  const [soundEffectUrl, setSoundEffectUrl] = useState<string | null>(null);
  const bgmRef = React.useRef<HTMLAudioElement>(null);
  const soundEffectRef = React.useRef<HTMLAudioElement>(null);

  // 画像一覧を読み込む
  useEffect(() => {
    loadImages();
    loadGroundPosition();
    loadAudioFiles();
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

  // 地面位置の設定を読み込む
  const loadGroundPosition = async () => {
    try {
      const settings = await loadSettings();
      if (settings?.groundPosition !== undefined) {
        setGroundPosition(settings.groundPosition);
      }
    } catch (error) {
      console.error('地面位置の読み込みエラー:', error);
    }
  };

  // 音声ファイルを読み込む
  const loadAudioFiles = async () => {
    try {
      const metadata = await getAllMetadata();
      const bgmFile = metadata.find(m => m.type === 'bgm');
      const soundEffectFile = metadata.find(m => m.type === 'soundEffect');
      
      if (bgmFile) {
        const bgmData = await loadImage(bgmFile);
        setBgmUrl(bgmData);
      }
      
      if (soundEffectFile) {
        const soundData = await loadImage(soundEffectFile);
        setSoundEffectUrl(soundData);
      }
    } catch (error) {
      console.error('音声ファイルの読み込みエラー:', error);
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
    
    // BGMを再生
    if (bgmRef.current && bgmUrl) {
      bgmRef.current.play().catch(e => console.error('BGM再生エラー:', e));
    }
    
    // 効果音を再生（アニメーション開始時）
    if (soundEffectRef.current && soundEffectUrl) {
      soundEffectRef.current.play().catch(e => console.error('効果音再生エラー:', e));
    }
  };

  // アニメーションを停止
  const stopAnimation = () => {
    setIsPlaying(false);
    setAnimatedImages([]);
    
    // BGMを停止
    if (bgmRef.current) {
      bgmRef.current.pause();
      bgmRef.current.currentTime = 0;
    }
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
      {/* 音声要素（非表示） */}
      {bgmUrl && (
        <audio ref={bgmRef} src={bgmUrl} loop style={{ display: 'none' }} />
      )}
      {soundEffectUrl && (
        <audio ref={soundEffectRef} src={soundEffectUrl} style={{ display: 'none' }} />
      )}
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
            groundPosition={groundPosition}
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