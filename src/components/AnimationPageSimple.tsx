import React, { useEffect, useState, useCallback } from 'react';
import AnimationView from './AnimationView';
import { useAudio } from '../hooks/useAudio';
import { useAnimationData } from '../hooks/useAnimationData';
import { AppSettingsService } from '../services/database';
import { useDataChangeListener } from '../events/useDataChangeListener';
import styles from './AnimationPage.module.scss';

const AnimationPageSimple: React.FC = () => {
  const [groundPosition, setGroundPosition] = useState(80);
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [backgroundType, setBackgroundType] = useState<string>('image');
  const [isInitialized, setIsInitialized] = useState(false);

  const { 
    bgmUrl, soundEffectUrl, bgmRef, soundEffectRef, 
    audioPermissionNeeded, loadAudioFiles, playEffect, retryAudioPlayback 
  } = useAudio();

  const { animatedImages, updateImages, newImageAdded, setNewImageAdded } = useAnimationData();

  // --- 新規画像追加を監視して効果音を再生 ---
  useEffect(() => {
    if (newImageAdded && isInitialized && soundEffectUrl) {
      playEffect();
      setNewImageAdded(false); // フラグをリセット
    }
  }, [newImageAdded, isInitialized, soundEffectUrl, playEffect, setNewImageAdded]);


  const loadBackground = useCallback(async () => {
    try {
      const { getAllMetadata, loadImage } = await import('../services/imageStorage');
      const metadata = await getAllMetadata();
      const background = metadata.find(m => (m as any).image_type === 'background');
      if (background) {
        const backgroundData = await loadImage(background);
        setBackgroundUrl(backgroundData);
        setBackgroundType(background.originalFileName.match(/\.(mp4|mov)$/i) ? 'video' : 'image');
      } else {
        setBackgroundUrl(null);
      }
    } catch (error) {
      console.error('背景の読み込みエラー:', error);
    }
  }, []);

  // --- 初期化処理 ---
  useEffect(() => {
    const initialize = async () => {
      const position = await AppSettingsService.getGroundPosition();
      setGroundPosition(position);
      await loadBackground();
      await loadAudioFiles();
      await updateImages(true); // 初期ロードフラグをtrueで渡す
      setIsInitialized(true);
    };
    initialize();
  }, [loadBackground, loadAudioFiles, updateImages]);

  // --- イベントハンドラ ---
  const handleImageChange = useCallback(async (imageId?: string) => {
    // ファイルシステムへの書き込み完了を待つ
    await new Promise(resolve => setTimeout(resolve, 500));
    await updateImages();
  }, [updateImages]);

  const handleAudioChange = useCallback(async () => {
    await loadAudioFiles();
  }, [loadAudioFiles]);

  const handleBackgroundChange = useCallback(async () => {
    await loadBackground();
  }, [loadBackground]);

  const handleGroundPositionChange = useCallback((position: number) => {
    setGroundPosition(position);
  }, []);

  // --- イベントリスナーの設定 ---
  useDataChangeListener({
    onImageAdded: handleImageChange,
    onImageDeleted: handleImageChange,
    onAudioUpdated: handleAudioChange,
    onBackgroundChanged: handleBackgroundChange,
    onAnimationSettingsChanged: handleImageChange,
    onGroundPositionChanged: handleGroundPositionChange,
  });

  return (
    <div className={styles.animationPage}>
      {bgmUrl && <audio ref={bgmRef} src={bgmUrl} loop autoPlay preload="auto" style={{ display: 'none' }} />}
      {soundEffectUrl && <audio ref={soundEffectRef} src={soundEffectUrl} preload="auto" style={{ display: 'none' }} />}
      
      <AnimationView
        images={animatedImages}
        groundPosition={groundPosition}
        backgroundUrl={backgroundUrl}
        backgroundType={backgroundType}
      />
      
      {audioPermissionNeeded && (
        <div className={styles.audioPermissionBanner}>
          <p>音声を再生するにはクリックしてください</p>
          <button onClick={retryAudioPlayback} className={styles.audioButton}>
            音声を再生
          </button>
        </div>
      )}
    </div>
  );
};

export default AnimationPageSimple;
