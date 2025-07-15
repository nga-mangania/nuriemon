import { useState, useEffect, useRef } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { saveImage, saveBackgroundFile } from '../services/imageStorage';
import { loadSettings, saveSettings } from '../services/settings';
import { saveMovementSettings } from '../services/movementStorage';
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

  // 音楽設定
  const [bgmFile, setBgmFile] = useState<{name: string, data: string} | null>(null);
  const [soundEffectFile, setSoundEffectFile] = useState<{name: string, data: string} | null>(null);

  // 非表示までの時間設定
  const [deletionTime, setDeletionTime] = useState('unlimited');

  // お絵かきアップロード
  const [image, setImage] = useState<{name: string, data: string} | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [movementSettings, setMovementSettings] = useState({
    type: 'walk',
    movement: 'normal',
    speed: 0.5,
    size: 'medium'
  });

  // 設定を読み込み
  useEffect(() => {
    const loadUserSettings = async () => {
      const settings = await loadSettings();
      if (settings) {
        setDeletionTime(settings.deletionTime || 'unlimited');
        setGroundPosition(settings.groundPosition || 50);
        if (settings.backgroundUrl) {
          setCurrentBackground({
            url: settings.backgroundUrl,
            type: settings.backgroundType || 'image'
          });
        }
      }
    };
    loadUserSettings();
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
        setBackgroundFile({ name: fileName, data: dataUrl, type: isVideo ? 'video' : 'image' });
      }
    } catch (error) {
      console.error('背景ファイル選択エラー:', error);
      alert('背景ファイルの選択に失敗しました');
    }
  };

  const handleBackgroundUpload = async () => {
    if (!backgroundFile) return;
    
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
      const metadata = await saveBackgroundFile(backgroundFile.data, backgroundFile.name);
      clearInterval(progressInterval);
      setBackgroundProgress(100);
      
      const currentSettings = await loadSettings();
      await saveSettings({
        ...currentSettings,
        backgroundUrl: backgroundFile.data,
        backgroundType: backgroundFile.type
      });
      
      setCurrentBackground({
        url: backgroundFile.data,
        type: backgroundFile.type
      });
      
      alert('背景ファイルは正常にアップロードされました');
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
    if (confirm('背景を削除しますか？')) {
      const currentSettings = await loadSettings();
      await saveSettings({
        ...currentSettings,
        backgroundUrl: null,
        backgroundType: null
      });
      setCurrentBackground(null);
      alert('背景ファイルを削除しました');
    }
  };

  const clearBackgroundSelection = () => {
    setBackgroundFile(null);
  };

  // STEP 02: 地面の位置設定
  const handleGroundPositionChange = async (position: number) => {
    setGroundPosition(position);
    const currentSettings = await loadSettings();
    await saveSettings({ ...currentSettings, groundPosition: position });
  };

  // STEP 03: 音楽の設定
  const handleBgmChange = (file: {name: string, data: string} | null) => {
    setBgmFile(file);
  };

  const handleSoundEffectChange = (file: {name: string, data: string} | null) => {
    setSoundEffectFile(file);
  };

  // STEP 04: 非表示までの時間設定
  const handleDeletionTimeChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newTime = e.target.value;
    setDeletionTime(newTime);
    const currentSettings = await loadSettings();
    await saveSettings({ ...currentSettings, deletionTime: newTime });
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
        setImage({ name: fileName, data: dataUrl });
      }
    } catch (error) {
      console.error('画像選択エラー:', error);
      alert('画像の選択に失敗しました');
    }
  };

  const handleImageUpload = async () => {
    if (!image) return;
    
    setUploadingImage(true);
    setUploadProgress(0);
    
    const progressInterval = setInterval(() => {
      setUploadProgress(prev => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return 90;
        }
        return prev + 10;
      });
    }, 200);

    try {
      // まず元画像を保存
      const metadata = await saveImage(image.data, image.name, 'original');
      
      // 背景除去処理を実行
      setUploadProgress(50);
      const result = await invoke<{ success: boolean; image?: string; error?: string }>('process_image', {
        imageData: image.data
      });
      
      if (result.success && result.image) {
        // 処理済み画像を保存
        const processedFileName = image.name.replace(/\.[^/.]+$/, '') + '-nobg.png';
        await saveImage(result.image, processedFileName, 'processed');
        setUploadProgress(90);
      }
      
      clearInterval(progressInterval);
      setUploadProgress(100);
      
      // 動き設定を保存
      await saveMovementSettings(metadata.id, movementSettings);
      
      // 最後の動き設定も保存（次回のデフォルト値として）
      const currentSettings = await loadSettings();
      await saveSettings({
        ...currentSettings,
        lastMovementSettings: movementSettings
      });
      
      alert('画像は正常にアップロードされ、背景が除去されました');
      clearImageSelection();
    } catch (error) {
      clearInterval(progressInterval);
      console.error('画像アップロードエラー:', error);
      alert('画像のアップロードに失敗しました');
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
              >
                背景を選択
              </button>
              <button
                onClick={handleBackgroundUpload}
                disabled={!backgroundFile || uploadingBackground}
                className={styles.uploadButton}
              >
                {uploadingBackground ? 'アップロード中...' : 'アップロード'}
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
                <button onClick={handleRemoveBackground} className={styles.deleteBtn}>
                  <i className="fas fa-trash-alt"></i>
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
          <AudioSettings
            onBgmChange={handleBgmChange}
            onSoundEffectChange={handleSoundEffectChange}
          />
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
            onSettingsChange={setMovementSettings}
          />
          
          <div className={styles.uploadBox}>
            <h3>画像</h3>
            <div className={styles.uploadControls}>
              <button
                className={styles.fileInputLabel}
                onClick={handleImageSelect}
              >
                ファイルを選択
              </button>
              <button
                onClick={handleImageUpload}
                disabled={!image || uploadingImage}
                className={styles.uploadButton}
              >
                {uploadingImage ? 'アップロード中...' : 'アップロード（背景除去）'}
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