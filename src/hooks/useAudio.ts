import { useState, useEffect, useRef, useCallback } from 'react';
import { getAllMetadata, getFilePathForMetadata, filePathToUrl } from '../services/imageStorage';

export const useAudio = () => {
  const [bgmUrl, setBgmUrl] = useState<string | null>(null);
  const [soundEffectUrl, setSoundEffectUrl] = useState<string | null>(null);
  const bgmRef = useRef<HTMLAudioElement>(null);
  const soundEffectRef = useRef<HTMLAudioElement>(null);
  const [audioPermissionNeeded, setAudioPermissionNeeded] = useState(false);
  const audioPoolRef = useRef<HTMLAudioElement[]>([]);

  const loadAudioFiles = useCallback(async () => {
    try {
      const metadata = await getAllMetadata();
      const bgmFile = metadata.find(m => (m as any).type === 'bgm' || (m as any).image_type === 'bgm');
      const soundEffectFile = metadata.find(m => (m as any).type === 'soundEffect' || (m as any).image_type === 'soundEffect');
      
      if (bgmFile) {
        const p = await getFilePathForMetadata({ ...bgmFile, image_type: 'bgm' });
        setBgmUrl(filePathToUrl(p));
      } else {
        setBgmUrl(null);
      }
      
      if (soundEffectFile) {
        const p = await getFilePathForMetadata({ ...soundEffectFile, image_type: 'soundEffect' });
        setSoundEffectUrl(filePathToUrl(p));
      } else {
        setSoundEffectUrl(null);
      }
    } catch (error) {
      console.error('音声ファイルの読み込みエラー:', error);
    }
  }, []);

  useEffect(() => {
    if (bgmUrl && bgmRef.current) {
      const el = bgmRef.current;
      el.preload = 'auto';
      el.loop = true;
      el.volume = 0.5;
      // canplaythrough まで待つとカクつきが減る
      const onReady = () => {
        el.play().catch(e => {
          if (e.name === 'NotAllowedError') setAudioPermissionNeeded(true);
        });
        el.removeEventListener('canplaythrough', onReady);
      };
      el.addEventListener('canplaythrough', onReady, { once: true });
      // 既に読み込み済みなら即再生
      if (el.readyState >= 3) {
        el.removeEventListener('canplaythrough', onReady);
        el.play().catch(e => {
          if (e.name === 'NotAllowedError') setAudioPermissionNeeded(true);
        });
      } else {
        el.load();
      }
    }
  }, [bgmUrl]);

  // 音声プールを初期化
  useEffect(() => {
    if (soundEffectUrl) {
      // 既存のプールをクリア
      audioPoolRef.current = [];
      
      // 3つの音声要素を作成（同時再生対応）
      for (let i = 0; i < 3; i++) {
        const audio = new Audio(soundEffectUrl);
        audio.preload = 'auto';
        audio.volume = 0.5; // 音量を設定
        
        audioPoolRef.current.push(audio);
      }
    }
  }, [soundEffectUrl]);

  const playEffect = useCallback(async () => {
    // 音声プール方式を使用
    if (soundEffectUrl && audioPoolRef.current.length > 0) {
      
      // 再生可能な音声要素を探す（readyStateも確認）
      const availableAudioIndex = audioPoolRef.current.findIndex(audio => 
        (audio.paused || audio.ended) && audio.readyState >= 3
      );
      
      if (availableAudioIndex !== -1) {
        const availableAudio = audioPoolRef.current[availableAudioIndex];
        
        // 音声をリセット
        availableAudio.pause();
        availableAudio.currentTime = 0;
        
        // 少し待機してから再生（ブラウザの制限回避）
        await new Promise(resolve => setTimeout(resolve, 10));
        
        const playPromise = availableAudio.play();
        
        if (playPromise !== undefined) {
          playPromise.catch((error) => {
            console.error('[useAudio] playEffect: 再生エラー:', error);
          });
        }
      } else {
        // フォールバック: 新しい音声要素を作成して再生
        const newAudio = new Audio(soundEffectUrl);
        newAudio.volume = 0.5;
        newAudio.play().catch(e => console.error('フォールバック再生エラー:', e));
      }
    } else if (soundEffectUrl && soundEffectRef.current) {
      // フォールバック: 従来の方法
      const audio = soundEffectRef.current;
      audio.pause();
      audio.currentTime = 0;
      audio.play().catch(e => console.error('再生エラー:', e));
    }
  }, [soundEffectUrl]);

  const retryAudioPlayback = useCallback(() => {
    if (bgmRef.current && bgmUrl) {
      bgmRef.current.play().then(() => setAudioPermissionNeeded(false)).catch(console.error);
    }
  }, [bgmUrl]);

  return {
    bgmUrl,
    soundEffectUrl,
    bgmRef,
    soundEffectRef,
    audioPermissionNeeded,
    loadAudioFiles,
    playEffect,
    retryAudioPlayback
  };
};
