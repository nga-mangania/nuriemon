import { useEffect, useRef } from 'react';
import styles from './ImagePreview.module.scss';

interface ImagePreviewProps {
  imageData: string | null;
  fileName: string | null;
}

export function ImagePreview({ imageData, fileName }: ImagePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!imageData || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      // キャンバスのサイズを設定
      const maxWidth = 800;
      const maxHeight = 600;
      
      let width = img.width;
      let height = img.height;

      // アスペクト比を保ちながらリサイズ
      if (width > maxWidth || height > maxHeight) {
        const aspectRatio = width / height;
        
        if (width > height) {
          width = maxWidth;
          height = width / aspectRatio;
        } else {
          height = maxHeight;
          width = height * aspectRatio;
        }
      }

      canvas.width = width;
      canvas.height = height;

      // 画像を描画
      ctx.drawImage(img, 0, 0, width, height);
    };

    img.src = imageData;
  }, [imageData]);

  if (!imageData) {
    return (
      <div className={styles.noImage}>
        <p>画像が選択されていません</p>
      </div>
    );
  }

  return (
    <div className={styles.preview}>
      <h3 className={styles.title}>プレビュー</h3>
      {fileName && <p className={styles.fileName}>{fileName}</p>}
      <div className={styles.canvasContainer}>
        <canvas ref={canvasRef} className={styles.canvas} />
      </div>
    </div>
  );
}