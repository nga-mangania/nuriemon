import { useState, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { saveImage } from '../services/imageStorage';
import { AppSettingsService } from '../services/database';
import { saveMovementSettings } from '../services/movementStorage';
import { MovementSettings } from './MovementSettings';
import { AutoImportService } from '../services/autoImportService';
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

  // 自動取り込み関連のstate
  const [autoImportEnabled, setAutoImportEnabled] = useState(false);
  const [autoImportPath, setAutoImportPath] = useState<string | null>(null);
  const [isStartingAutoImport, setIsStartingAutoImport] = useState(false);

  // loadUserSettings関数を外部定義
  const loadUserSettings = async () => {
    // 動き設定の読み込み（現在は設定に保存されていない）
    // TODO: 動き設定を別途管理する仕組みが必要
    
    // フォルダ設定を読み込み（表示用）
    const settings = await AppSettingsService.getSettings();
    console.log('[UploadPage] 現在の保存設定:', settings);
    
    // 自動取り込み設定を読み込み
    const autoImportService = AutoImportService.getInstance();
    const importPath = await AppSettingsService.getAutoImportPath();
    const importEnabled = await AppSettingsService.getAutoImportEnabled();
    setAutoImportPath(importPath);
    setAutoImportEnabled(importEnabled && autoImportService.isCurrentlyWatching());
  };

  // 設定を読み込み
  useEffect(() => {
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

    // ワークスペース変更イベントをリッスン
    const workspaceUnlistenPromise = listen('workspace-data-loaded', async () => {
      console.log('[UploadPage] ワークスペースデータ読み込み完了を検知');
      // 設定を再読み込み
      await loadUserSettings();
      
      // 自動取り込みが有効な場合は再開始が必要
      const autoImportService = AutoImportService.getInstance();
      const currentPath = await AppSettingsService.getAutoImportPath();
      const currentEnabled = await AppSettingsService.getAutoImportEnabled();
      
      console.log('[UploadPage] 自動取り込み状態:', {
        enabled: currentEnabled,
        path: currentPath,
        isWatching: autoImportService.isCurrentlyWatching()
      });
      
      if (currentEnabled && currentPath) {
        console.log('[UploadPage] 自動取り込みを再開始します');
        try {
          // 一旦停止してから再開始
          await autoImportService.stopWatching();
          // Rust側で新しいワークスペースパスを使うように再開始
          await autoImportService.startWatching(currentPath);
          console.log('[UploadPage] 自動取り込み再開始完了');
        } catch (error) {
          console.error('[UploadPage] 自動取り込み再開始エラー:', error);
        }
      }
    });

    return () => {
      unlistenPromise.then(f => f());
      settingsUnlistenPromise.then(f => f());
      workspaceUnlistenPromise.then(f => f());
    };
  }, []); // 依存配列から削除

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

        {/* 区切り線 */}
        <div className={styles.divider}>
          <span>または</span>
        </div>

        {/* 自動取り込み設定 */}
        <div className={styles.autoImportSection}>
          <h2>📁 フォルダを監視して自動取り込み</h2>
          
          <div className={styles.autoImportSettings}>
            <div className={styles.autoImportPath}>
              <p>監視フォルダ: {autoImportPath || '未設定'}</p>
              <button
                className={styles.selectFolderButton}
                onClick={async () => {
                  try {
                    const selected = await open({
                      directory: true,
                      multiple: false,
                      title: '監視するフォルダを選択'
                    });
                    
                    if (selected && typeof selected === 'string') {
                      setAutoImportPath(selected);
                      await AppSettingsService.setAutoImportPath(selected);
                    }
                  } catch (error) {
                    console.error('フォルダ選択エラー:', error);
                    alert('フォルダの選択に失敗しました');
                  }
                }}
              >
                フォルダを選択
              </button>
            </div>
            
            <div className={styles.autoImportToggle}>
              <label>
                <input
                  type="checkbox"
                  checked={autoImportEnabled}
                  onChange={async (e) => {
                    const enabled = e.target.checked;
                    
                    if (enabled) {
                      if (!autoImportPath) {
                        alert('先に監視フォルダを選択してください');
                        return;
                      }
                      
                      try {
                        setIsStartingAutoImport(true);
                        const autoImportService = AutoImportService.getInstance();
                        await autoImportService.startWatching(autoImportPath);
                        setAutoImportEnabled(true);
                      } catch (error) {
                        console.error('自動取り込み開始エラー:', error);
                        alert('自動取り込みの開始に失敗しました');
                        setAutoImportEnabled(false);
                      } finally {
                        setIsStartingAutoImport(false);
                      }
                    } else {
                      const autoImportService = AutoImportService.getInstance();
                      await autoImportService.stopWatching();
                      setAutoImportEnabled(false);
                    }
                  }}
                  disabled={isStartingAutoImport}
                />
                {isStartingAutoImport ? '開始中...' : '監視を開始'}
              </label>
              {autoImportEnabled && (
                <span className={styles.statusBadge}>監視中</span>
              )}
            </div>
          </div>
          
          <div className={styles.note}>
            <p>💡 新しい画像が追加されると自動的に背景除去して処理されます</p>
            <p>※ スキャナーの保存先フォルダを指定すると便利です</p>
          </div>
        </div>
      </div>
    </div>
  );
}