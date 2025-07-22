import { useState, useEffect, useRef } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { saveImage } from '../services/imageStorage';
import { loadSettings } from '../services/settings';
import styles from './FileUpload.module.scss';

interface FileUploadProps {
  onImageSelect: (imageData: string, fileName: string) => void;
  onImageSaved?: (metadata: any) => void;
  movementSettings?: {
    type: string;
    movement: string;
    speed: number;
    size: string;
  };
  onMovementSettingsChange?: (settings: any) => void;
}

export function FileUpload({ 
  onImageSelect, 
  onImageSaved,
  movementSettings = {
    type: 'walk',
    movement: 'normal',
    speed: 0.5,
    size: 'medium'
  },
  onMovementSettingsChange 
}: FileUploadProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{name: string, data: string} | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async () => {
    setIsLoading(true);
    
    try {
      // ファイル選択ダイアログを開く
      const selected = await open({
        multiple: false,
        filters: [{
          name: '画像ファイル',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp']
        }]
      });

      if (selected) {
        // ファイルを読み込む
        const fileData = await readFile(selected as string);
        
        // バイナリデータをBase64に変換
        const base64 = btoa(
          new Uint8Array(fileData).reduce(
            (data, byte) => data + String.fromCharCode(byte),
            ''
          )
        );
        
        // ファイル名を取得
        const fileName = (selected as string).split(/[/\\]/).pop() || 'unknown';
        
        // MIMEタイプを推測
        const extension = fileName.split('.').pop()?.toLowerCase();
        const mimeType = extension === 'png' ? 'image/png' : 
                        extension === 'gif' ? 'image/gif' : 
                        extension === 'webp' ? 'image/webp' : 
                        'image/jpeg';
        
        const dataUrl = `data:${mimeType};base64,${base64}`;
        
        setSelectedFile({ name: fileName, data: dataUrl });
        onImageSelect(dataUrl, fileName);
      }
    } catch (error) {
      console.error('ファイル選択エラー:', error);
      alert('ファイルの選択に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    
    try {
      setIsSaving(true);
      
      const metadata = await saveImage(selectedFile.data, selectedFile.name, 'original');
      
      if (onImageSaved) {
        onImageSaved(metadata);
      }
      
      alert('画像は正常にアップロードされました');
      clearSelection();
    } catch (saveError) {
      console.error('画像保存エラー:', saveError);
      alert('画像の保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  const clearSelection = () => {
    setSelectedFile(null);
    onImageSelect('', '');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className={styles.fileUpload}>
      <p className={styles.step}>STEP 05</p>
      <h2 className={styles.title}>お絵かきアップロード</h2>
      
      {/* 動き設定セクション */}
      {onMovementSettingsChange && (
        <div className={styles.movementSettings}>
          <h3>動き設定</h3>
          <div className={styles.settingGroup}>
            <label>動きのタイプ</label>
            <select 
              value={movementSettings.type}
              onChange={(e) => onMovementSettingsChange({ ...movementSettings, type: e.target.value })}
            >
              <option value="walk">歩く</option>
              <option value="fly">飛ぶ</option>
              <option value="swim">泳ぐ</option>
            </select>
          </div>
          
          <div className={styles.settingGroup}>
            <label>動きのパターン</label>
            <select 
              value={movementSettings.movement}
              onChange={(e) => onMovementSettingsChange({ ...movementSettings, movement: e.target.value })}
            >
              <option value="normal">通常</option>
              <option value="zigzag">ジグザグ</option>
              <option value="bounce">バウンス</option>
              <option value="circle">円形</option>
              <option value="wave">波</option>
              <option value="random">ランダム</option>
            </select>
          </div>
          
          <div className={styles.settingGroup}>
            <label>画面を動く速さ: {movementSettings.speed}</label>
            <input 
              type="range" 
              min="0" 
              max="2" 
              step="0.1"
              value={movementSettings.speed}
              onChange={(e) => onMovementSettingsChange({ ...movementSettings, speed: parseFloat(e.target.value) })}
              className={styles.speedSlider}
            />
            <div className={styles.speedLabels}>
              <span>0</span>
              <span>2</span>
            </div>
          </div>
          
          <div className={styles.settingGroup}>
            <label>サイズ</label>
            <select 
              value={movementSettings.size}
              onChange={(e) => onMovementSettingsChange({ ...movementSettings, size: e.target.value })}
            >
              <option value="small">小</option>
              <option value="medium">中</option>
              <option value="large">大</option>
            </select>
          </div>
        </div>
      )}
      
      <div className={styles.uploadBox}>
        <h3>画像</h3>
        <div className={styles.uploadControls}>
          <label className={styles.fileInputLabel}>
            ファイルを選択
            <input
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              ref={fileInputRef}
              style={{ display: 'none' }}
            />
          </label>
          <button
            className={styles.uploadButton}
            onClick={handleUpload}
            disabled={!selectedFile || isSaving}
          >
            {isSaving ? 'アップロード中...' : 'アップロード'}
          </button>
        </div>
        
        {selectedFile && (
          <div className={styles.fileInfo}>
            <span className={styles.fileIcon}>
              <i className="fa-regular fa-file"></i>
            </span>
            <span className={styles.fileName}>{selectedFile.name}</span>
            <button className={styles.fileClear} onClick={clearSelection}>
              <i className="fa-solid fa-delete-left"></i>
            </button>
          </div>
        )}
        
        {isSaving && (
          <p>保存中...</p>
        )}
      </div>
      
      <div className={styles.note}>
        <p>対応ファイル：jpg、png (10MB以下)</p>
        <p>※画面を動く速さを0にするとその場に留まります。</p>
      </div>
    </div>
  );
}