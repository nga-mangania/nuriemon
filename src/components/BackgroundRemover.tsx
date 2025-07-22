import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { saveImage } from '../services/imageStorage';
import styles from './BackgroundRemover.module.scss';

interface BackgroundRemoverProps {
  imageData: string | null;
  fileName: string | null;
  onProcessed?: (processedImage: string, fileName: string) => void;
  onSaved?: () => void;
}

interface ProcessResult {
  success: boolean;
  image?: string;
  error?: string;
}

export function BackgroundRemover({ imageData, fileName, onProcessed, onSaved }: BackgroundRemoverProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processProgress, setProcessProgress] = useState(0);

  useEffect(() => {
    const unlistenPromise = listen<{value: number}>('image-processing-progress', (event) => {
      setProcessProgress(event.payload.value);
    });

    return () => {
      unlistenPromise.then(f => f());
    };
  }, []);

  const handleRemoveBackground = async () => {
    if (!imageData || !fileName) {
      setError('画像を選択してください');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setProcessProgress(0);

    try {
      // Rustコマンドを呼び出してPython処理を実行
      const result = await invoke<ProcessResult>('process_image', {
        imageData: imageData
      });

      if (result.success && result.image) {
        setProcessProgress(100);
        
        // 処理済み画像を表示
        const processedFileName = fileName.replace(/\.[^/.]+$/, '') + '-nobg.png';
        if (onProcessed) {
          onProcessed(result.image, processedFileName);
        }

        // 処理済み画像を保存
        await saveImage(result.image, processedFileName, 'processed');
        
        if (onSaved) {
          onSaved();
        }
        
        alert('背景除去が完了しました');
      } else {
        setError(result.error || '画像処理に失敗しました');
      }
    } catch (error) {
      console.error('背景除去エラー:', error);
      setError('背景除去処理中にエラーが発生しました');
    } finally {
      setIsProcessing(false);
      setProcessProgress(0);
    }
  };

  return (
    <div className={styles.backgroundRemover}>
      <p className={styles.step}>STEP 02</p>
      <h2 className={styles.title}>背景除去</h2>
      
      <div className={styles.removeSection}>
        <button
          className={styles.removeButton}
          onClick={handleRemoveBackground}
          disabled={!imageData || isProcessing}
        >
          {isProcessing ? '処理中...' : '背景を除去'}
        </button>
        
        {isProcessing && (
          <div className={styles.progressBarContainer}>
            <div className={styles.progressBar} style={{ width: `${processProgress}%` }}>
              <span className={styles.progressText}>{Math.round(processProgress)}%</span>
            </div>
          </div>
        )}
        
        {error && (
          <p className={styles.errorText}>{error}</p>
        )}
      </div>
      
      <div className={styles.note}>
        <p>画像から背景を自動的に除去します</p>
        <p>※処理には少し時間がかかる場合があります</p>
      </div>
    </div>
  );
}