import { useState, useEffect, useRef } from 'react';
import { open, confirm as tauriConfirm } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { saveImage, saveBackgroundFile, getAllMetadata, loadImage, deleteImage } from '../services/imageStorage';
import { loadSettings, saveSettings } from '../services/settings';
import { saveMovementSettings } from '../services/movementStorage';
import { AppSettingsService } from '../services/database';
import { MovementSettings } from './MovementSettings';
import { GroundSetting } from './GroundSetting';
import { AudioSettings } from './AudioSettings';
import { ShareUrl } from './ShareUrl';
import styles from './UploadPage.module.scss';

export function UploadPage() {
  // 背景設定
  const [backgroundFile, setBackgroundFile] = useState<{name: string, data: string, type: string} | null>(null);
  const [currentBackground, setCurrentBackground] = useState<{url: string, type: string} | null>(null);
  const [uploadingBackground, setUploadingBackground] = useState(false);
  const [backgroundProgress, setBackgroundProgress] = useState(0);

  // 地面の位置設定
  const [groundPosition, setGroundPosition] = useState(50);


  // 非表示までの時間設定
  const [deletionTime, setDeletionTime] = useState('unlimited');

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
      // SQLiteから地面位置と削除時間を読み込み
      const [groundPos, delTime] = await Promise.all([
        AppSettingsService.getGroundPosition(),
        AppSettingsService.getDeletionTime()
      ]);
      
      setGroundPosition(groundPos);
      setDeletionTime(delTime);
      
      // その他の設定はsettings.jsonから読み込み
      const settings = await loadSettings();
      if (settings) {
        // 動き設定を読み込み
        if (settings.lastMovementSettings) {
          setMovementSettings(settings.lastMovementSettings);
        }
      }
      
      // 背景をデータベースから読み込み
      try {
        const metadata = await getAllMetadata();
        const background = metadata.find(m => (m as any).image_type === 'background');
        if (background) {
          const backgroundData = await loadImage(background);
          setCurrentBackground({
            url: backgroundData,
            type: background.originalFileName.match(/\.(mp4|mov)$/i) ? 'video' : 'image'
          });
        }
      } catch (error) {
        console.error('背景の読み込みエラー:', error);
      }
    };
    loadUserSettings();

    const unlistenPromise = listen<{value: number}>('image-processing-progress', (event) => {
      console.log('[UploadPage] 進捗イベント受信:', event.payload.value);
      setUploadProgress(event.payload.value);
    });

    return () => {
      unlistenPromise.then(f => f());
    };
  }, []);

  // STEP 01: 背景の設定
  const handleBackgroundSelect = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: '背景ファイル',
          extensions: ['png', 'jpg', 'jpeg', 'mp4', 'mov']
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
        const isVideo = extension === 'mp4' || extension === 'mov';
        const mimeType = isVideo ? `video/${extension}` : 
                        extension === 'png' ? 'image/png' : 'image/jpeg';
        
        const dataUrl = `data:${mimeType};base64,${base64}`;
        const fileInfo = { name: fileName, data: dataUrl, type: isVideo ? 'video' : 'image' };
        setBackgroundFile(fileInfo);
        
        // 自動でアップロード
        await handleBackgroundUpload(fileInfo);
      }
    } catch (error) {
      console.error('背景ファイル選択エラー:', error);
      alert('背景ファイルの選択に失敗しました');
    }
  };

  const handleBackgroundUpload = async (fileToUpload?: {name: string, data: string, type: string}) => {
    const file = fileToUpload || backgroundFile;
    if (!file) return;
    
    setUploadingBackground(true);
    setBackgroundProgress(0);
    
    const progressInterval = setInterval(() => {
      setBackgroundProgress(prev => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return 90;
        }
        return prev + 10;
      });
    }, 200);

    try {
      const metadata = await saveBackgroundFile(file.data, file.name);
      clearInterval(progressInterval);
      setBackgroundProgress(100);
      
      setCurrentBackground({
        url: file.data,
        type: file.type
      });
      
      // アップロード成功（alertは削除）
      setBackgroundFile(null);
    } catch (error) {
      clearInterval(progressInterval);
      console.error('背景アップロードエラー:', error);
      alert('背景ファイルのアップロードに失敗しました');
    } finally {
      setUploadingBackground(false);
      setBackgroundProgress(0);
    }
  };

  const handleRemoveBackground = async () => {
    // Tauriのダイアログを使用
    const confirmed = await tauriConfirm('背景を削除しますか？', {
      title: '削除の確認',
      type: 'warning'
    });
    
    if (confirmed) {
      try {
        // データベースから背景を削除
        const metadata = await getAllMetadata();
        const background = metadata.find(m => (m as any).image_type === 'background');
        
        if (background) {
          await deleteImage(background);
        }
        
        setCurrentBackground(null);
      } catch (error) {
        console.error('背景削除エラー:', error);
        alert('背景の削除に失敗しました');
      }
    }
  };

  const clearBackgroundSelection = () => {
    setBackgroundFile(null);
  };

  // STEP 02: 地面の位置設定
  const handleGroundPositionChange = async (position: number) => {
    setGroundPosition(position);
    // SQLiteに保存
    await AppSettingsService.saveGroundPosition(position);
  };


  // STEP 04: 非表示までの時間設定
  const handleDeletionTimeChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newTime = e.target.value;
    setDeletionTime(newTime);
    // SQLiteに保存
    await AppSettingsService.saveDeletionTime(newTime);
  };

  // STEP 05: お絵かきアップロード
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
      // base64データは長すぎるので短縮して表示
      const logResult = result.image && result.image.length > 100
        ? { ...result, image: `${result.image.substring(0, 50)}...(残り${result.image.length - 50}文字)` }
        : result;
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
      
      // 最後の動き設定も保存（次回のデフォルト値として）
      const currentSettings = await loadSettings();
      await saveSettings({
        ...currentSettings,
        lastMovementSettings: movementSettings
      });
      
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
        {/* STEP 01: 背景の設定 */}
        <div className={styles.uploadSection}>
          <p className={styles.step}>STEP 01</p>
          <h2>背景の設定</h2>
          <div className={styles.uploadBox}>
            <h3>背景</h3>
            <div className={styles.uploadControls}>
              <button
                className={styles.fileInputLabel}
                onClick={handleBackgroundSelect}
                disabled={uploadingBackground}
              >
                {uploadingBackground ? 'アップロード中...' : '背景を選択'}
              </button>
            </div>
            
            {backgroundFile && (
              <div className={styles.fileInfo}>
                <span className={styles.fileIcon}>
                  <i className="fa-regular fa-file"></i>
                </span>
                <span className={styles.fileName}>{backgroundFile.name}</span>
                <button className={styles.fileClear} onClick={clearBackgroundSelection}>
                  <i className="fa-solid fa-delete-left"></i>
                </button>
              </div>
            )}
            
            {uploadingBackground && (
              <div className={styles.progressBarContainer}>
                <div className={styles.progressBar} style={{ width: `${backgroundProgress}%` }}>
                  <span className={styles.progressText}>{Math.round(backgroundProgress)}%</span>
                </div>
              </div>
            )}
            
            {currentBackground && (
              <div className={styles.backgroundPreview}>
                {currentBackground.type === 'image' ? (
                  <img src={currentBackground.url} alt="現在の背景" />
                ) : (
                  <video src={currentBackground.url} controls />
                )}
                <button 
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    await handleRemoveBackground();
                  }} 
                  className={styles.deleteBtn}
                  type="button"
                  title="背景を削除"
                >
                  <i className="fas fa-trash-alt"></i> 背景を削除
                </button>
              </div>
            )}
          </div>
          <div className={styles.note}>
            <p>対応ファイル</p>
            <p>画像：jpg、png(20MB以下)</p>
            <p>動画：mp4、mov(20MB以下)</p>
          </div>
        </div>

        {/* STEP 02: 地面の位置設定 */}
        <div className={styles.uploadSection}>
          <p className={styles.step}>STEP 02</p>
          <h2>地面の位置設定</h2>
          <GroundSetting
            backgroundUrl={currentBackground?.url}
            backgroundType={currentBackground?.type}
            onGroundPositionChange={handleGroundPositionChange}
            initialGroundPosition={groundPosition}
          />
          <div className={styles.note}>
            <p>赤線をドラッグして地面の位置を調整して下さい。(スマートフォンの場合はタップして下さい。)</p>
          </div>
        </div>

        {/* STEP 03: 音楽の設定 */}
        <div className={styles.uploadSection}>
          <p className={styles.step}>STEP 03</p>
          <h2>音楽の設定</h2>
          <AudioSettings />
          <div className={styles.note}>
            <p>対応ファイル：mp3、mp4(BGM50MB・効果音1MB以下)</p>
            <p>※効果音は新規画像がスクリーンに登場した時に再生されます。</p>
          </div>
        </div>

        {/* STEP 04: 非表示までの時間設定 */}
        <div className={styles.uploadSection}>
          <p className={styles.step}>STEP 04</p>
          <h2>非表示までの時間設定</h2>
          <select value={deletionTime} onChange={handleDeletionTimeChange}>
            <option value="unlimited">無制限</option>
            <option value="1">1分</option>
            <option value="2">2分</option>
            <option value="3">3分</option>
            <option value="4">4分</option>
            <option value="5">5分</option>
            <option value="6">6分</option>
            <option value="7">7分</option>
            <option value="8">8分</option>
            <option value="9">9分</option>
            <option value="10">10分</option>
            <option value="15">15分</option>
            <option value="20">20分</option>
            <option value="30">30分</option>
          </select>
          <div className={styles.note}>
            <p>アップロードされたお絵描きが表示されてから消えるまでの時間を設定できます。</p>
            <p>例：「1分」に設定すると、画像はアップロードから1分後にスクリーンから消えます。</p>
            <p>※「無制限」に設定すると、お絵描き一覧から削除するまでスクリーンに残り続けます。</p>
            <p>※設定を途中で変更する場合は、 <a href="/gallery">お絵描き一覧</a> からすべての画像を削除した後に変更してください。</p>
          </div>
        </div>

        {/* STEP 05: お絵かきアップロード */}
        <div className={styles.uploadSection}>
          <p className={styles.step}>STEP 05</p>
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

        {/* STEP 06: スクリーンを表示 */}
        <div className={styles.uploadSection}>
          <p className={styles.step}>STEP 06</p>
          <h2>スクリーンを表示</h2>
          <a
            href="/animation"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.fileInputLabel}
          >
            スクリーン表示 <i className="fa-solid fa-up-right-from-square"></i>
          </a>
          <a
            href="/gallery"
            rel="noopener noreferrer"
            className={`${styles.fileInputLabelB} ${styles.mTop}`}
          >
            アップしたお絵描き一覧
          </a>
          <div className={styles.mTop}>
            <ShareUrl showTooltip={false} />
          </div>
          <div className={styles.note}>
            <p>表示されたページをサイネージなどのスクリーンに投影してください。</p>
            <p>共有を行うと、スクリーン共有用のURLが生成されます。</p>
            <p>このURLを共有すると、自身が作成したスクリーンをログインする事なく、誰でも閲覧できるようになります。</p>
            <p>※共有URLを削除して再生成すると、別のURLが発行されます。削除後に再生成した場合は、新しいURLを共有してください。</p>
          </div>
        </div>
      </div>
    </div>
  );
}