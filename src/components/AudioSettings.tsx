import { useState, useRef } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { saveAudioFile } from '../services/imageStorage';
import styles from './AudioSettings.module.scss';

interface AudioSettingsProps {
  onBgmChange?: (file: {name: string, data: string} | null) => void;
  onSoundEffectChange?: (file: {name: string, data: string} | null) => void;
}

export function AudioSettings({ onBgmChange, onSoundEffectChange }: AudioSettingsProps) {
  const [bgmFile, setBgmFile] = useState<{name: string, data: string} | null>(null);
  const [soundEffectFile, setSoundEffectFile] = useState<{name: string, data: string} | null>(null);
  const [uploadingBgm, setUploadingBgm] = useState(false);
  const [uploadingSoundEffect, setUploadingSoundEffect] = useState(false);

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
        if (onBgmChange) onBgmChange(file);
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
        if (onSoundEffectChange) onSoundEffectChange(file);
      }
    } catch (error) {
      console.error('効果音選択エラー:', error);
      alert('効果音ファイルの選択に失敗しました');
    }
  };

  const handleBgmUpload = async () => {
    if (!bgmFile) return;
    
    setUploadingBgm(true);
    try {
      await saveAudioFile(bgmFile.data, bgmFile.name, 'bgm');
      alert('BGMがアップロードされました');
    } catch (error) {
      console.error('BGMアップロードエラー:', error);
      alert('BGMのアップロードに失敗しました');
    } finally {
      setUploadingBgm(false);
    }
  };

  const handleSoundEffectUpload = async () => {
    if (!soundEffectFile) return;
    
    setUploadingSoundEffect(true);
    try {
      await saveAudioFile(soundEffectFile.data, soundEffectFile.name, 'soundEffect');
      alert('効果音がアップロードされました');
    } catch (error) {
      console.error('効果音アップロードエラー:', error);
      alert('効果音のアップロードに失敗しました');
    } finally {
      setUploadingSoundEffect(false);
    }
  };

  const clearBgmSelection = () => {
    setBgmFile(null);
    if (onBgmChange) onBgmChange(null);
  };

  const clearSoundEffectSelection = () => {
    setSoundEffectFile(null);
    if (onSoundEffectChange) onSoundEffectChange(null);
  };

  return (
    <div className={styles.audioSettings}>
      <div className={styles.audioSection}>
        <h3>BGM</h3>
        <div className={styles.uploadControls}>
          <button
            className={styles.fileInputLabel}
            onClick={handleBgmSelect}
          >
            BGMを選択
          </button>
          <button
            onClick={handleBgmUpload}
            disabled={!bgmFile || uploadingBgm}
            className={styles.uploadButton}
          >
            {uploadingBgm ? 'アップロード中...' : 'アップロード'}
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
        
        {bgmFile && (
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
          >
            効果音を選択
          </button>
          <button
            onClick={handleSoundEffectUpload}
            disabled={!soundEffectFile || uploadingSoundEffect}
            className={styles.uploadButton}
          >
            {uploadingSoundEffect ? 'アップロード中...' : 'アップロード'}
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
        
        {soundEffectFile && (
          <audio controls className={styles.audioPreview}>
            <source src={soundEffectFile.data} />
          </audio>
        )}
      </div>
    </div>
  );
}