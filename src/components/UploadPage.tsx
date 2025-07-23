import { useState, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { saveImage } from '../services/imageStorage';
import { AppSettingsService } from '../services/database';
import { saveMovementSettings } from '../services/movementStorage';
import { MovementSettings } from './MovementSettings';
import styles from './UploadPage.module.scss';

export function UploadPage() {
  // お絵かきアップロード
  const [image, setImage] = useState<{name: string, data: string} | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [movementSettings, setMovementSettings] = useState<{
    type: 'walk' | 'fly';
    movement: string;
    speed: number;
    size: string;
  }>({
    type: 'walk',
    movement: 'normal',
    speed: 0.5,
    size: 'medium'
  });

  // 設定を読み込み
  useEffect(() => {
    const loadUserSettings = async () => {
      // 動き設定の読み込み（現在は設定に保存されていない）
      // TODO: 動き設定を別途管理する仕組みが必要
      
      // フォルダ設定を読み込み（表示用）
      const settings = await AppSettingsService.getSettings();
      console.log('[UploadPage] 現在の保存設定:', settings);
    };
    loadUserSettings();

    const unlistenPromise = listen<{value: number}>('image-processing-progress', (event) => {
      console.log('[UploadPage] 進捗イベント受信:', event.payload.value);
      setUploadProgress(event.payload.value);
    });

    // 設定変更イベントをリッスン
    const settingsUnlistenPromise = listen('settings-change', async () => {
      console.log('[UploadPage] 設定変更イベントを受信');
      await loadUserSettings();
    });

    return () => {
      unlistenPromise.then(f => f());
      settingsUnlistenPromise.then(f => f());
    };
  }, []);

  // お絵かきアップロード
  const handleImageSelect = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: '画像ファイル',
          extensions: ['png', 'jpg', 'jpeg']
        }]
      });

      if (selected) {
        const fileData = await readFile(selected as string);
        const base64 = btoa(
          new Uint8Array(fileData).reduce(
            (data, byte) => data + String.fromCharCode(byte),
            ''
          )
        );
        
        const fileName = (selected as string).split(/[/\\]/).pop() || 'unknown';
        const extension = fileName.split('.').pop()?.toLowerCase();
        const mimeType = extension === 'png' ? 'image/png' : 'image/jpeg';
        
        const dataUrl = `data:${mimeType};base64,${base64}`;
        const imageInfo = { name: fileName, data: dataUrl };
        setImage(imageInfo);
        
        // 自動でアップロード
        await handleImageUpload(imageInfo);
      }
    } catch (error) {
      console.error('画像選択エラー:', error);
      alert('画像の選択に失敗しました');
    }
  };

  const handleImageUpload = async (imageToUpload?: {name: string, data: string}) => {
    const img = imageToUpload || image;
    if (!img) return;
    
    setUploadingImage(true);
    setUploadProgress(0);

    try {
      // まず元画像を保存
      await saveImage(img.data, img.name, 'original');
      
      // 背景除去処理を実行
      console.log('[UploadPage] 背景除去処理を開始');
      const result = await invoke<{ success: boolean; image?: string; error?: string }>('process_image', {
        imageData: img.data
      });
      console.log('[UploadPage] 背景除去処理結果:', result.success ? '成功' : '失敗', result.error);
      
      if (result.success && result.image) {
        // 処理済み画像を保存
        const processedFileName = img.name.replace(/\.[^/.]+$/, '') + '-nobg.png';
        console.log('[UploadPage] 処理済み画像を保存開始:', processedFileName);
        const processedMetadata = await saveImage(result.image, processedFileName, 'processed');
        console.log('[UploadPage] 処理済み画像保存完了:', processedMetadata.id);
        
        // 動き設定を処理済み画像のIDで保存
        console.log('[UploadPage] 動き設定を保存:', processedMetadata.id, movementSettings);
        await saveMovementSettings(processedMetadata.id, movementSettings);
        console.log('[UploadPage] 動き設定保存完了');
      } else {
        throw new Error(result.error || 'Background removal failed');
      }
      
      setUploadProgress(100);
      
      // 動き設定の保存は現在サポートされていません
      // TODO: 動き設定を保存する仕組みを実装
      
      // アラートは削除（処理完了は視覚的に分かるため）
      clearImageSelection();
    } catch (error) {
      console.error('[UploadPage] 画像アップロードエラー:', error);
      console.error('[UploadPage] エラー詳細:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      alert(`画像のアップロードに失敗しました: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setUploadingImage(false);
      setUploadProgress(0);
    }
  };

  const clearImageSelection = () => {
    setImage(null);
  };

  return (
    <div className={styles.uploadPage}>
      <div className={styles.container}>
        {/* お絵かきアップロード */}
        <div className={styles.uploadSection}>
          <h2>お絵かきアップロード</h2>
          <MovementSettings
            settings={movementSettings}
            onSettingsChange={(newSettings) => {
              setMovementSettings(prev => ({ ...prev, ...newSettings }));
            }}
          />
          
          <div className={styles.uploadBox}>
            <h3>画像</h3>
            <div className={styles.uploadControls}>
              <button
                className={styles.fileInputLabel}
                onClick={handleImageSelect}
                disabled={uploadingImage}
              >
                {uploadingImage ? 'アップロード中...' : 'ファイルを選択（背景除去）'}
              </button>
            </div>
            
            {image && (
              <div className={styles.fileInfo}>
                <span className={styles.fileIcon}>
                  <i className="fa-regular fa-file"></i>
                </span>
                <span className={styles.fileName}>{image.name}</span>
                <button className={styles.fileClear} onClick={clearImageSelection}>
                  <i className="fa-solid fa-delete-left"></i>
                </button>
              </div>
            )}
            
            {uploadingImage && (
              <div className={styles.progressBarContainer}>
                <div className={styles.progressBar} style={{ width: `${uploadProgress}%` }}>
                  <span className={styles.progressText}>{Math.round(uploadProgress)}%</span>
                </div>
              </div>
            )}
          </div>
          <div className={styles.note}>
            <p>対応ファイル：jpg、png(10MB以下)</p>
            <p>※画面を動く速さを0にするとその場に留まります。</p>
            <p>※アップロード時に自動的に背景が除去されます。</p>
          </div>
        </div>
      </div>
    </div>
  );
}