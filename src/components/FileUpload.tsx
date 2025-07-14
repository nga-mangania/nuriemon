import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import styles from './FileUpload.module.scss';

interface FileUploadProps {
  onImageSelect: (imageData: string, fileName: string) => void;
}

export function FileUpload({ onImageSelect }: FileUploadProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

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
        
        setSelectedFileName(fileName);
        onImageSelect(dataUrl, fileName);
      }
    } catch (error) {
      console.error('ファイル選択エラー:', error);
      alert('ファイルの選択に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.fileUpload}>
      <button 
        className={styles.selectButton}
        onClick={handleFileSelect}
        disabled={isLoading}
      >
        {isLoading ? '読み込み中...' : '画像を選択'}
      </button>
      {selectedFileName && (
        <p className={styles.fileName}>選択中: {selectedFileName}</p>
      )}
    </div>
  );
}