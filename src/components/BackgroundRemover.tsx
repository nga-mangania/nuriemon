import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { saveImage } from '../services/imageStorage';
import styles from './BackgroundRemover.module.scss';

interface BackgroundRemoverProps {
  imageData: string | null;
  fileName: string | null;
  onProcessed?: (processedImage: string) => void;
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

  const handleRemoveBackground = async () => {
    if (!imageData || !fileName) {
      setError('画像を選択してください');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      // Rustコマンドを呼び出してPython処理を実行
      const result = await invoke<ProcessResult>('process_image', {
        imageData: imageData
      });

      if (result.success && result.image) {
        // 処理済み画像を表示
        if (onProcessed) {
          onProcessed(result.image);
        }

        // 処理済み画像を保存
        const processedFileName = fileName.replace(/\.[^/.]+$/, '') + '-nobg.png';
        await saveImage(result.image, processedFileName, 'processed');
        
        if (onSaved) {
          onSaved();
        }
      } else {
        setError(result.error || '画像処理に失敗しました');
      }
    } catch (error) {
      console.error('背景除去エラー:', error);
      setError('背景除去処理中にエラーが発生しました');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className={styles.backgroundRemover}>
      <button
        className={styles.removeButton}
        onClick={handleRemoveBackground}
        disabled={!imageData || isProcessing}
      >
        {isProcessing ? '処理中...' : '背景を除去'}
      </button>
      
      {isProcessing && (
        <p className={styles.processingText}>
          背景除去処理を実行中です。しばらくお待ちください...
        </p>
      )}
      
      {error && (
        <p className={styles.errorText}>{error}</p>
      )}
    </div>
  );
}