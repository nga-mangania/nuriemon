import { useState, useEffect } from 'react';
import styles from './GroundSetting.module.scss';

interface GroundSettingProps {
  backgroundUrl?: string;
  backgroundType?: string;
  onGroundPositionChange: (position: number) => void;
  initialGroundPosition?: number;
}

export function GroundSetting({ 
  backgroundUrl, 
  backgroundType, 
  onGroundPositionChange,
  initialGroundPosition = 50 
}: GroundSettingProps) {
  const [groundPosition, setGroundPosition] = useState(initialGroundPosition);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    setGroundPosition(initialGroundPosition);
  }, [initialGroundPosition]);

  const handleMouseDown = () => {
    setIsDragging(true);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const percentage = Math.max(0, Math.min(100, (y / rect.height) * 100));
    
    setGroundPosition(percentage);
    onGroundPositionChange(percentage);
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const percentage = Math.max(0, Math.min(100, (y / rect.height) * 100));
    
    setGroundPosition(percentage);
    onGroundPositionChange(percentage);
  };

  return (
    <div className={styles.groundSettingContainer}>
      <div 
        className={styles.previewArea}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseUp}
        onClick={handleClick}
      >
        {backgroundUrl ? (
          backgroundType === 'video' ? (
            <video 
              src={backgroundUrl} 
              className={styles.backgroundMedia}
              muted
              loop
            />
          ) : (
            <img 
              src={backgroundUrl} 
              alt="背景" 
              className={styles.backgroundMedia}
            />
          )
        ) : (
          <div className={styles.placeholder}>
            背景を設定してください
          </div>
        )}
        
        <div 
          className={styles.groundLine}
          style={{ top: `${groundPosition}%` }}
        >
          <div className={styles.lineHandle} />
        </div>
      </div>
      
      <p className={styles.positionText}>
        地面の位置: {Math.round(groundPosition)}%
      </p>
    </div>
  );
}