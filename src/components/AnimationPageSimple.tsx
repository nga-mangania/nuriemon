import React, { useEffect, useState, useCallback } from 'react';
import AnimationView from './AnimationView';
import { useAudio } from '../hooks/useAudio';
import { useAnimationData } from '../hooks/useAnimationData';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { listen } from '@tauri-apps/api/event';
import styles from './AnimationPage.module.scss';

const AnimationPageSimple: React.FC = () => {
  // Zustandストアから状態を取得（setGroundPositionとsetBackgroundのみ使用）
  const { 
    setBackground 
  } = useWorkspaceStore();
  
  const [isInitialized, setIsInitialized] = useState(false);

  const { 
    bgmUrl, soundEffectUrl, bgmRef, soundEffectRef, 
    audioPermissionNeeded, loadAudioFiles, playEffect, retryAudioPlayback 
  } = useAudio();

  const { animatedImages, refresh, newImageAdded, setNewImageAdded } = useAnimationData();

  // --- 新規画像追加を監視して効果音を再生 ---
  useEffect(() => {
    if (newImageAdded && isInitialized && soundEffectUrl) {
      playEffect();
      setNewImageAdded(false); // フラグをリセット
    }
  }, [newImageAdded, isInitialized, soundEffectUrl, playEffect, setNewImageAdded]);


  const loadBackground = useCallback(async () => {
    try {
      const { getAllMetadata, loadImage, getFilePathForMetadata, filePathToUrl } = await import('../services/imageStorage');
      const metadata = await getAllMetadata();
      const background = metadata.find(m => (m as any).image_type === 'background');
      if (background) {
        const isVideo = /\.(mp4|mov)$/i.test(background.originalFileName);
        if (isVideo) {
          // Use file URL for video to avoid base64 overhead and stutter
          const abs = await getFilePathForMetadata({ ...background, image_type: 'background' } as any);
          const url = filePathToUrl(abs);
          setBackground(url, 'video');
        } else {
          // Images can remain as data URL (or also file URL if desired)
          const backgroundData = await loadImage(background);
          setBackground(backgroundData, 'image');
        }
      } else {
        setBackground(null, 'image');
      }
    } catch (error) {
      console.error('背景の読み込みエラー:', error);
    }
  }, [setBackground]);

  // --- 初期化処理 ---
  useEffect(() => {
    const initialize = async () => {
      // Zustandストアが既に設定を管理しているため、背景とオーディオの読み込みのみ行う
      await loadBackground();
      await loadAudioFiles();
      await refresh({ initial: true });
      setIsInitialized(true);
    };
    initialize();
  }, [loadBackground, loadAudioFiles, refresh]);

  // --- イベントハンドラ ---
  // data-changedイベントリスナーは削除（Zustandストアへの統一のため）
  // 画像、オーディオ、背景の変更は必要に応じて別のTauriイベントで通知される
  // 地面位置の変更はZustandストアから直接購読される

  // --- ワークスペース変更を監視 ---
  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const pending: Array<Promise<void>> = [];

    const register = () => {
      const promise = listen('workspace-data-loaded', async () => {
        console.log('[AnimationPageSimple] ワークスペースデータ読み込み完了を検知');
        await loadBackground();
        await loadAudioFiles();
        await refresh();
      })
        .then((off) => {
          if (disposed) {
            try { off(); } catch {}
            return;
          }
          unlisteners.push(() => { try { off(); } catch {} });
        })
        .catch((error) => {
          console.error('[AnimationPageSimple] Failed to register workspace listener:', error);
        });
      pending.push(promise);
    };

    register();

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
      pending.forEach((p) => p.catch(() => {}));
    };
  }, [loadBackground, loadAudioFiles, refresh]);

  return (
    <div className={styles.animationPage}>
      {bgmUrl && <audio ref={bgmRef} src={bgmUrl} loop autoPlay preload="auto" style={{ display: 'none' }} />}
      {soundEffectUrl && <audio ref={soundEffectRef} src={soundEffectUrl} preload="auto" style={{ display: 'none' }} />}
      
      <AnimationView
        images={animatedImages}
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
