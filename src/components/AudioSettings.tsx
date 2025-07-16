import { useState, useRef, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { saveAudioFile, getAllMetadata, deleteImage, loadImage } from '../services/imageStorage';
import styles from './AudioSettings.module.scss';

export function AudioSettings() {
  const [bgmFile, setBgmFile] = useState<{name: string, data: string, uploaded?: boolean, id?: string} | null>(null);
  const [soundEffectFile, setSoundEffectFile] = useState<{name: string, data: string, uploaded?: boolean, id?: string} | null>(null);
  const [uploadingBgm, setUploadingBgm] = useState(false);
  const [uploadingSoundEffect, setUploadingSoundEffect] = useState(false);

  // 既存の音声ファイルを読み込み
  useEffect(() => {
    const loadExistingAudioFiles = async () => {
      try {
        const metadata = await getAllMetadata();
        const bgm = metadata.find(m => (m as any).image_type === 'bgm');
        const soundEffect = metadata.find(m => (m as any).image_type === 'soundEffect');
        
        if (bgm) {
          const bgmData = await loadImage(bgm);
          setBgmFile({ name: bgm.originalFileName, data: bgmData, uploaded: true, id: bgm.id });
        }
        if (soundEffect) {
          const soundData = await loadImage(soundEffect);
          setSoundEffectFile({ name: soundEffect.originalFileName, data: soundData, uploaded: true, id: soundEffect.id });
        }
      } catch (error) {
        console.error('既存音声ファイルの読み込みエラー:', error);
      }
    };
    
    loadExistingAudioFiles();
  }, []);

  const handleBgmSelect = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'BGMファイル',
          extensions: ['mp3', 'mp4', 'wav']
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
        const mimeType = `audio/${extension === 'mp4' ? 'mp4' : extension}`;
        
        const dataUrl = `data:${mimeType};base64,${base64}`;
        const file = { name: fileName, data: dataUrl };
        setBgmFile(file);
        
        // 自動でアップロード
        await handleBgmUpload(file);
      }
    } catch (error) {
      console.error('BGM選択エラー:', error);
      alert('BGMファイルの選択に失敗しました');
    }
  };

  const handleSoundEffectSelect = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: '効果音ファイル',
          extensions: ['mp3', 'wav']
        }]
      });

      if (selected) {
        const fileData = await readFile(selected as string);
        
        // ファイルサイズチェック (1MB)
        if (fileData.byteLength > 1024 * 1024) {
          alert('効果音ファイルは1MB以下にしてください');
          return;
        }
        
        const base64 = btoa(
          new Uint8Array(fileData).reduce(
            (data, byte) => data + String.fromCharCode(byte),
            ''
          )
        );
        
        const fileName = (selected as string).split(/[/\\]/).pop() || 'unknown';
        const extension = fileName.split('.').pop()?.toLowerCase();
        const mimeType = `audio/${extension}`;
        
        const dataUrl = `data:${mimeType};base64,${base64}`;
        const file = { name: fileName, data: dataUrl };
        setSoundEffectFile(file);
        
        // 自動でアップロード
        await handleSoundEffectUpload(file);
      }
    } catch (error) {
      console.error('効果音選択エラー:', error);
      alert('効果音ファイルの選択に失敗しました');
    }
  };

  const handleBgmUpload = async (fileToUpload?: {name: string, data: string}) => {
    const file = fileToUpload || bgmFile;
    if (!file) return;
    
    setUploadingBgm(true);
    try {
      const metadata = await saveAudioFile(file.data, file.name, 'bgm');
      setBgmFile({ ...file, uploaded: true, id: metadata.id });
      alert('BGMがアップロードされました');
    } catch (error) {
      console.error('BGMアップロードエラー:', error);
      alert('BGMのアップロードに失敗しました');
    } finally {
      setUploadingBgm(false);
    }
  };

  const handleSoundEffectUpload = async (fileToUpload?: {name: string, data: string}) => {
    const file = fileToUpload || soundEffectFile;
    if (!file) return;
    
    setUploadingSoundEffect(true);
    try {
      const metadata = await saveAudioFile(file.data, file.name, 'soundEffect');
      setSoundEffectFile({ ...file, uploaded: true, id: metadata.id });
      alert('効果音がアップロードされました');
    } catch (error) {
      console.error('効果音アップロードエラー:', error);
      alert('効果音のアップロードに失敗しました');
    } finally {
      setUploadingSoundEffect(false);
    }
  };

  const clearBgmSelection = async () => {
    if (bgmFile?.uploaded && bgmFile?.id) {
      if (!confirm('BGMを削除しますか？')) {
        return;
      }
      try {
        await deleteImage({ id: bgmFile.id } as any);
        alert('BGMを削除しました');
      } catch (error) {
        console.error('BGM削除エラー:', error);
        alert('BGMの削除に失敗しました');
        return;
      }
    }
    setBgmFile(null);
  };

  const clearSoundEffectSelection = async () => {
    if (soundEffectFile?.uploaded && soundEffectFile?.id) {
      if (!confirm('効果音を削除しますか？')) {
        return;
      }
      try {
        await deleteImage({ id: soundEffectFile.id } as any);
        alert('効果音を削除しました');
      } catch (error) {
        console.error('効果音削除エラー:', error);
        alert('効果音の削除に失敗しました');
        return;
      }
    }
    setSoundEffectFile(null);
  };

  return (
    <div className={styles.audioSettings}>
      <div className={styles.audioSection}>
        <h3>BGM</h3>
        <div className={styles.uploadControls}>
          <button
            className={styles.fileInputLabel}
            onClick={handleBgmSelect}
            disabled={uploadingBgm}
          >
            {uploadingBgm ? 'アップロード中...' : 'BGMを選択'}
          </button>
        </div>
        
        {bgmFile && (
          <div className={styles.fileInfo}>
            <span className={styles.fileIcon}>
              <i className="fa-regular fa-file-audio"></i>
            </span>
            <span className={styles.fileName}>{bgmFile.name}</span>
            <button className={styles.fileClear} onClick={clearBgmSelection}>
              <i className="fa-solid fa-delete-left"></i>
            </button>
          </div>
        )}
        
        {bgmFile && bgmFile.data && (
          <audio controls className={styles.audioPreview}>
            <source src={bgmFile.data} />
          </audio>
        )}
      </div>

      <div className={styles.audioSection}>
        <h3>効果音</h3>
        <div className={styles.uploadControls}>
          <button
            className={styles.fileInputLabel}
            onClick={handleSoundEffectSelect}
            disabled={uploadingSoundEffect}
          >
            {uploadingSoundEffect ? 'アップロード中...' : '効果音を選択'}
          </button>
        </div>
        
        {soundEffectFile && (
          <div className={styles.fileInfo}>
            <span className={styles.fileIcon}>
              <i className="fa-regular fa-file-audio"></i>
            </span>
            <span className={styles.fileName}>{soundEffectFile.name}</span>
            <button className={styles.fileClear} onClick={clearSoundEffectSelection}>
              <i className="fa-solid fa-delete-left"></i>
            </button>
          </div>
        )}
        
        {soundEffectFile && soundEffectFile.data && (
          <audio controls className={styles.audioPreview}>
            <source src={soundEffectFile.data} />
          </audio>
        )}
      </div>
    </div>
  );
}