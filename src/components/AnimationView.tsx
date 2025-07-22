import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createNoise2D } from 'simplex-noise';
import {
  SPEED_SETTINGS,
  SIZE_SETTINGS,
  MOVEMENT_SETTINGS,
  AnimatedImage,
  SpecialMovement,
  textEmotes,
  svgEmotes,
} from '../services/animationSettings';
import styles from './AnimationView.module.scss';

const noise2D = createNoise2D();

interface AnimationViewProps {
  images: Array<{
    id: string;
    imageUrl: string;
    originalFileName: string;
    type: 'walk' | 'fly';
    movement: string;
    size: string;
    speed: number;
  }>;
  groundPosition?: number;
  backgroundUrl?: string | null;
  backgroundType?: string;
  onImageClick?: (imageId: string) => void;
}

const AnimationView: React.FC<AnimationViewProps> = ({ 
  images: inputImages, 
  groundPosition = 80,
  backgroundUrl,
  backgroundType = 'image',
  onImageClick 
}) => {
  const [animatedImages, setAnimatedImages] = useState<AnimatedImage[]>([]);
  const animatedImagesRef = useRef<Record<string, AnimatedImage>>({});
  const animationRef = useRef<number>();
  const canvasRef = useRef<HTMLDivElement>(null);
  

  // 特殊な動きを管理する関数
  const applySpecialMovement = useCallback((image: AnimatedImage, currentTime: number): AnimatedImage => {
    if (!image.specialMovement) {
      if (image.specialMovementCooldown <= 0 && Math.random() < 0.0995) {
        const type = Math.floor(Math.random() * 5);
        image.specialMovement = {
          type,
          startTime: currentTime,
          duration: 300 + Math.random() * 400,
          originalVelocityX: image.velocityX,
          originalVelocityY: image.velocityY,
          originalY: image.y,
        };
        image.specialMovementCooldown = 10000;
      } else {
        image.specialMovementCooldown = Math.max(0, (image.specialMovementCooldown || 0) - 16);
      }
    }

    if (image.specialMovement) {
      const elapsedTime = currentTime - image.specialMovement.startTime;
      const progress = Math.min(elapsedTime / image.specialMovement.duration, 1);

      switch (image.specialMovement.type) {
        case 0: // 急回転
          image.rotation += 360 * Math.sin(progress * Math.PI);
          break;
        case 1: // 加速と減速
          const maxSpeedMultiplier = 1.3;
          const speedCurve = Math.sin(progress * Math.PI);
          const currentSpeedMultiplier = 1 + (maxSpeedMultiplier - 1) * speedCurve;
          image.velocityX = image.specialMovement.originalVelocityX * currentSpeedMultiplier;
          image.velocityY = image.specialMovement.originalVelocityY * currentSpeedMultiplier;
          break;
        case 2: // サイズ変化
          const peakScale = 2;
          const sharpness = 1;
          const sizeChange = 1 + (peakScale - 1) * Math.sin(progress * Math.PI) ** sharpness;
          image.specialScale = sizeChange;
          break;
        case 3: // Z軸回転
          const rotationProgress = Math.sin(progress * Math.PI);
          image.zRotation = 360 * rotationProgress;
          image.scale = 1 - 0.5 * Math.abs(rotationProgress);
          break;
        case 4: // ジャンプ
          const jumpHeight = 20;
          const jumpProgress = Math.sin(progress * Math.PI);
          const verticalOffset = jumpHeight * jumpProgress;
          image.y = image.specialMovement.originalY - verticalOffset;
          break;
      }

      if (progress >= 1) {
        image.velocityX = image.specialMovement.originalVelocityX;
        image.velocityY = image.specialMovement.originalVelocityY;
        image.specialMovement = null;
        image.zRotation = 0;
        image.rotation = 0;
        image.specialScale = 1;
      }
    }

    image.x = Math.max(0, Math.min(100, image.x));
    image.y = Math.max(0, Math.min(100, image.y));

    return image;
  }, []);

  // 画像を初期化
  const initializeImage = useCallback((data: any): AnimatedImage => {
    return {
      ...data,
      x: Math.random() * 80 + 10,
      y: data.type === 'walk' ? groundPosition : Math.random() * (groundPosition - 20) + 10,
      velocityX: (Math.random() - 0.5) * 0.5,
      velocityY: data.type === 'walk' ? 0 : (Math.random() - 0.5) * 0.5,
      scale: 1,
      rotation: 0,
      zRotation: 0,
      flipped: false,
      directionChangeTimer: Math.random() * 200 + 100,
      offset: Math.random() * 10000,
      phaseOffset: Math.random() * Math.PI * 2,
      lastMovementUpdate: Date.now(),
      nextMovementUpdate: Date.now() + Math.random() * 5000,
      globalScale: 1,
      scaleDirection: Math.random() < 0.5 ? 1 : -1,
      scaleSpeed: Math.random() * 0.001 + 0.0005,
      animationStartTime: Date.now(),
      isNewImage: false,
      specialMovementCooldown: 0,
    };
  }, [groundPosition]);

  // 画像を移動
  const moveImage = useCallback((image: AnimatedImage): AnimatedImage => {
    // エモート処理
    if (Math.random() < 0.001) {
      if (Math.random() < 0.3) {
        image.emote = {
          type: "text",
          content: textEmotes[Math.floor(Math.random() * textEmotes.length)],
        };
      } else {
        image.emote = {
          type: "svg",
          content: svgEmotes[Math.floor(Math.random() * svgEmotes.length)],
        };
      }
      image.emoteTimer = 150;
    } else if ((image.emoteTimer || 0) > 0) {
      image.emoteTimer = (image.emoteTimer || 0) - 1;
    } else {
      image.emote = null;
    }

    const currentTime = Date.now();
    const currentSpeed = SPEED_SETTINGS[image.speed as keyof typeof SPEED_SETTINGS] || SPEED_SETTINGS.medium;
    const amplitudeFactor = SIZE_SETTINGS[image.size as keyof typeof SIZE_SETTINGS] || SIZE_SETTINGS.medium;

    // 通常の動き
    const baseVelocity = 0.3;
    const scaledVelocityX = image.velocityX * baseVelocity * currentSpeed;
    const scaledVelocityY = image.velocityY * baseVelocity * currentSpeed;

    const noiseScale = 0.05;
    const noiseX = noise2D(currentTime * 0.001 + image.offset, 0) * noiseScale * currentSpeed;
    const noiseY = noise2D(currentTime * 0.001 + image.offset + 1000, 0) * noiseScale * currentSpeed;

    if (image.type === "walk") {
      image.y = groundPosition;
      image.x += scaledVelocityX + noiseX;

      if (image.x <= -5 || image.x >= 95) {
        image.velocityX *= -1;
        image.x = Math.max(-5, Math.min(95, image.x));
        image.flipped = !image.flipped;
      }
    } else if (image.type === "fly") {
      image.x += scaledVelocityX + noiseX;
      image.y += scaledVelocityY + noiseY;

      if (image.x <= -5 || image.x >= 95) {
        image.velocityX *= -1;
        image.x = Math.max(-5, Math.min(95, image.x));
        image.flipped = !image.flipped;
      }

      const maxHeight = 5;
      const minHeight = groundPosition;

      if (image.y <= maxHeight || image.y >= minHeight) {
        image.velocityY *= -1;
        image.y = Math.max(maxHeight, Math.min(minHeight, image.y));
      }
    }

    // 方向変更
    image.directionChangeTimer -= 1;
    if (image.directionChangeTimer <= 0) {
      image.velocityX = (Math.random() - 0.5) * 1;
      image.velocityY = (Math.random() - 0.5) * 1;
      image.directionChangeTimer = Math.random() * 50 + 25;
    }

    // グローバルスケールの変更
    if (!image.specialMovement) {
      const MIN_SCALE = 0.9;
      const MAX_SCALE = 1.7;

      image.globalScale += image.scaleDirection * image.scaleSpeed;
      if (image.globalScale > MAX_SCALE) {
        image.globalScale = MAX_SCALE;
        image.scaleDirection *= -1;
      } else if (image.globalScale < MIN_SCALE) {
        image.globalScale = MIN_SCALE;
        image.scaleDirection *= -1;
      }
    }

    // 動きパターンの適用
    const movement = MOVEMENT_SETTINGS[image.movement];
    if (movement) {
      const { x = 0, y = 0, rotation, scaleX, scaleY } = movement(
        currentTime,
        amplitudeFactor,
        image.offset,
        image.phaseOffset
      );

      image.x += x;
      image.y += y;

      if (rotation !== undefined) {
        image.rotation = rotation;
      }

      if (scaleX !== undefined && scaleY !== undefined) {
        image.scaleX = scaleX * image.globalScale;
        image.scaleY = scaleY * image.globalScale;
      } else {
        image.scaleX = image.scaleY = image.globalScale;
      }
    }

    // 特殊な動きを適用
    return applySpecialMovement(image, currentTime);
  }, [groundPosition, applySpecialMovement]);

  // アニメーションループ
  useEffect(() => {
    function animate() {
      const updatedImages = Object.values(animatedImagesRef.current).map(image => moveImage(image));
      
      animatedImagesRef.current = updatedImages.reduce((acc, img) => {
        acc[img.id] = img;
        return acc;
      }, {} as Record<string, AnimatedImage>);

      setAnimatedImages(updatedImages);
      animationRef.current = requestAnimationFrame(animate);
    }

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [moveImage]);

  // 入力画像が変更されたら初期化
  useEffect(() => {
    const newImages = inputImages.map(img => {
      const existing = animatedImagesRef.current[img.id];
      if (existing) {
        // 既存の画像の設定を更新
        return {
          ...existing,
          type: img.type,
          movement: img.movement,
          size: img.size,
          speed: img.speed,
        };
      }
      // 新しい画像を初期化
      return initializeImage(img);
    });

    // 削除された画像を除外
    const currentIds = inputImages.map(img => img.id);
    animatedImagesRef.current = newImages.reduce((acc, img) => {
      if (currentIds.includes(img.id)) {
        acc[img.id] = img;
      }
      return acc;
    }, {} as Record<string, AnimatedImage>);
  }, [inputImages, initializeImage]);

  // デバッグ用のスタイル情報
  const containerStyle = backgroundUrl && backgroundType === 'image' 
    ? { backgroundImage: `url(${backgroundUrl})` }
    : !backgroundUrl 
      ? { background: 'linear-gradient(to bottom, #87CEEB 0%, #E0F6FF 50%, #E0F6FF 100%)' }
      : {};
  

  return (
    <div 
      className={styles.animationContainer} 
      ref={canvasRef}
      style={containerStyle}
    >
      {/* 動画背景の場合 */}
      {backgroundUrl && backgroundType === 'video' && (
        <video
          autoPlay
          loop
          muted
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            zIndex: 0
          }}
        >
          <source src={backgroundUrl} type={`video/${backgroundUrl.includes('.mov') ? 'quicktime' : 'mp4'}`} />
        </video>
      )}
      <div className={styles.imagesWrapper}>
        {animatedImages.map(image => (
          <div
            key={image.id}
            className={styles.imageContainer}
            style={{
              left: `${image.x}%`,
              top: `${image.y}%`,
              transform: `
                translate(-50%, -50%) 
                perspective(500px)
                ${image.zRotation ? `rotateY(${image.zRotation}deg)` : ''}
              `,
            }}
          >
            <img
              src={image.imageUrl}
              alt={image.originalFileName}
              className={`${styles.animatedImage} ${image.movement} ${image.size}`}
              style={{
                transform: `scale(${image.scaleX || 1}, ${image.scaleY || 1}) rotate(${
                  image.rotation
                }deg) scaleX(${image.flipped ? -1 : 1})`,
              }}
              onClick={() => onImageClick?.(image.id)}
            />
            {image.emote && (
              <div className={styles.emote}>
                {image.emote.type === "text" ? (
                  image.emote.content
                ) : (
                  <img
                    src={`/emotes/${image.emote.content}.svg`}
                    alt="Emote"
                  />
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className={styles.imageCounter}>
        <span>お絵かきの数</span>
        <p>{animatedImages.length}</p>
      </div>
    </div>
  );
};

export default AnimationView;