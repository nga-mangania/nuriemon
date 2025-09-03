import React, { useState, useEffect, useRef, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { createNoise2D } from 'simplex-noise';
import {
  SPEED_SETTINGS,
  SIZE_SETTINGS,
  MOVEMENT_SETTINGS,
  AnimatedImage,
  textEmotes,
  svgEmotes,
} from '../services/animationSettings';
import { useWorkspaceStore } from '../stores/workspaceStore';
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
  onImageClick?: (imageId: string) => void;
}

const AnimationView: React.FC<AnimationViewProps> = ({ 
  images: inputImages, 
  onImageClick 
}) => {
  // Zustandストアから直接状態を取得
  const {
    deletionTime,
    groundPosition,
    backgroundUrl,
    backgroundType
  } = useWorkspaceStore();
  
  // 表示用のリスト（追加/削除のときだけ更新し、毎フレームは更新しない）
  const [animatedImages, setAnimatedImages] = useState<AnimatedImage[]>([]);
  const animatedImagesRef = useRef<Record<string, AnimatedImage>>({});
  const animationRef = useRef<number>();
  const canvasRef = useRef<HTMLDivElement>(null);
  // DOM 直更新用の参照
  const containerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const imgRefs = useRef<Map<string, HTMLImageElement>>(new Map());
  const emoteRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  
  // デバッグログ：地面位置の確認
  useEffect(() => {
    console.log('[AnimationView] 地面位置が変更されました:', groundPosition);
  }, [groundPosition]);

  // モバイル操作の受信（move/action/emote）
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      unlisten = await listen<any>('mobile-control', (event) => {
        const payload: any = event.payload || {};
        const type = payload.type as string;
        const imageId = payload.imageId as string | undefined;
        try { console.log('[AnimationView] mobile-control:', { type, imageId, count: Object.keys(animatedImagesRef.current).length }); } catch {}

        const apply = (handler: (img: AnimatedImage) => void) => {
          if (imageId) {
            const img = animatedImagesRef.current[imageId];
            if (!img) {
              // 明示的なimageId指定で対象が存在しない場合は無視（他画像へ適用しない）
              try { console.warn('[AnimationView] target imageId not found; ignore command', imageId); } catch {}
              return;
            }
            handler(img);
            // React再レンダは不要（RAFでDOM直更新）
          } else {
            // imageIdが無い場合のみ、全画像に適用（レガシー/簡易UI互換）
            const ids = Object.keys(animatedImagesRef.current);
            ids.forEach((id) => {
              const img = animatedImagesRef.current[id];
              if (!img) return;
              handler(img);
            });
            // React再レンダは不要（RAFでDOM直更新）
          }
        };

        switch (type) {
          case 'move': {
            const dir = payload.direction as string | undefined;
            apply((img) => {
              // スムーズな操作: 即時位置変更はせず、なだらかに速度へ加算
              const accel = 0.25;
              if (dir === 'left') { img.velocityX += -accel; }
              if (dir === 'right') { img.velocityX += accel; }
              if (dir === 'up') { img.velocityY += -accel; }
              if (dir === 'down') { img.velocityY += accel; }
              // 速度の過度な増加を抑制
              const clamp = (v: number, a: number) => Math.max(-a, Math.min(a, v));
              img.velocityX = clamp(img.velocityX, 2);
              img.velocityY = clamp(img.velocityY, 2);
              // ランダム方向切替を短く抑えて、操作の方向性を少し維持
              img.directionChangeTimer = 18;
            });
            break;
          }
          case 'action': {
            const action = payload.actionType as string | undefined;
            const effective = (action && ['jump','spin','shake','grow','shrink'].includes(action)) ? action : 'jump';
            apply((img) => {
              const now = Date.now();
              // 特殊動作の上書き
              const base = {
                startTime: now,
                duration: 400,
                originalVelocityX: img.velocityX,
                originalVelocityY: img.velocityY,
                originalY: img.y,
              } as any;
              switch (effective) {
                case 'jump':
                  img.specialMovement = { ...base, type: 4 };
                  break;
                case 'spin':
                  img.specialMovement = { ...base, type: 3 };
                  break;
                case 'shake':
                  img.specialMovement = { ...base, type: 1 };
                  break;
                case 'grow':
                  img.specialMovement = { ...base, type: 2, scaleDir: 1 };
                  break;
                case 'shrink':
                  img.specialMovement = { ...base, type: 2, scaleDir: -1 };
                  break;
                default:
                  img.specialMovement = { ...base, type: 0 };
                  break;
              }
            });
            break;
          }
          case 'emote': {
            const emoteType = payload.emoteType as string | undefined;
            apply((img) => {
              if (!emoteType) return;
              // 既存SVGのみにフォールバック（存在しない場合はテキストに）
              const allowed = new Set(svgEmotes);
              if (allowed.has(emoteType)) {
                img.emote = { type: 'svg', content: emoteType } as any;
              } else {
                // 受信した文字列をそのままテキストエモートとして表示（例: 😊, ❤️ など）
                img.emote = { type: 'text', content: emoteType } as any;
              }
              img.emoteTimer = 150;
            });
            break;
          }
        }
      });
    };

    setup();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // エモートSVGの事前読み込み（同時デコードのスパイクを抑制）
  useEffect(() => {
    const cache: HTMLImageElement[] = [];
    try {
      svgEmotes.forEach(name => {
        const img = new Image();
        img.src = `/emotes/${name}.svg`;
        cache.push(img);
      });
    } catch {}
    return () => { cache.splice(0, cache.length); };
  }, []);
  // 削除時間のログは毎フレームの再レンダでノイズになるため削除
  
  // Zustandストアが削除時間を管理しているため、読み込みとイベントリスナーは不要
  

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
        case 1: { // ふるえる（シェイク）
          const amp = 1.5; // 振幅[%]
          const freq = 0.05; // 周期
          image.x += Math.sin(currentTime * freq) * amp;
          image.y += Math.cos(currentTime * freq * 1.3) * amp;
          break; }
        case 2: { // サイズ変化（grow/shrink）
          const peakScale = 1.6;
          const minScale = 0.6;
          const wave = Math.sin(progress * Math.PI);
          const dir = (image.specialMovement as any).scaleDir === -1 ? -1 : 1;
          image.specialScale = dir === 1
            ? 1 + (peakScale - 1) * wave
            : 1 - (1 - minScale) * wave;
          break; }
        case 3: // Z軸回転
          const rotationProgress = Math.sin(progress * Math.PI);
          image.zRotation = 360 * rotationProgress;
          image.scale = 1 - 0.5 * Math.abs(rotationProgress);
          break;
        case 4: // ジャンプ
          const jumpHeight = 35; // より分かりやすく高く
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
    // Y座標を動的に計算
    let initialY: number;
    if (data.type === 'walk') {
      // 歩くタイプは常に現在の地面位置
      initialY = groundPosition;
      console.log(`[AnimationView] 歩く画像 ${data.id} を地面位置 ${groundPosition} に配置`);
    } else {
      // 飛ぶタイプは地面位置を考慮してランダムに配置
      const minY = 10;
      const maxY = Math.max(groundPosition - 10, minY + 10);
      initialY = Math.random() * (maxY - minY) + minY;
    }
    
    return {
      ...data,
      x: Math.random() * 80 + 10,
      y: initialY,
      velocityX: (Math.random() - 0.5) * 0.5,
      velocityY: data.type === 'walk' ? 0 : (Math.random() - 0.5) * 0.5,
      scale: 1,
      createdAt: Date.now(), // 画像が作成された時刻を記録
      deletionTime: deletionTime, // 現在の削除時間設定を適用
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
  }, [groundPosition, deletionTime]);

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
    const currentSpeed = typeof image.speed === 'number' ? image.speed : (SPEED_SETTINGS[image.speed as keyof typeof SPEED_SETTINGS] || SPEED_SETTINGS.medium);
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
      const currentTime = Date.now();
      const updatedImages: AnimatedImage[] = [];
      
      const deletionTimeMs = (deletionTime !== 'unlimited')
        ? parseInt(deletionTime) * 60 * 1000
        : -1;

      // 非表示の永続化: 一度だけhide APIを叩くためのセット
      const toHide: string[] = [];

      for (const image of Object.values(animatedImagesRef.current)) {
        // 削除チェック
        if (deletionTimeMs > 0 && image.createdAt && currentTime - image.createdAt >= deletionTimeMs) {
          console.log(`[AnimationView] 画像 ${image.id} を非表示（時間経過）`);
          toHide.push(image.id);
          continue; // この画像は更新リストに追加しない（アニメ画面から消す）
        }

        // 画像の移動処理
        const moved = moveImage(image);
        updatedImages.push(moved);
        // DOMへスタイル反映（transform移動＋回転・スケール）
        const div = containerRefs.current.get(moved.id);
        if (div) {
          const t = `translate(${moved.x}vw, ${moved.y}vh) translate(-50%, -50%) perspective(500px) ${moved.zRotation ? `rotateY(${moved.zRotation}deg)` : ''}`;
          if (div.style.transform !== t) div.style.transform = t;
          if (div.style.display !== '') div.style.display = '';
        }
        const imgEl = imgRefs.current.get(moved.id);
        if (imgEl) {
          const sx = (moved.scaleX || 1) * (moved.specialScale || 1);
          const sy = (moved.scaleY || 1) * (moved.specialScale || 1);
          const st = `scale(${sx}, ${sy}) rotate(${moved.rotation}deg) scaleX(${moved.flipped ? -1 : 1})`;
          if (imgEl.style.transform !== st) imgEl.style.transform = st;
        }
        const em = emoteRefs.current.get(moved.id);
        if (em) {
          if (moved.emote) {
            if (em.style.display !== 'block') em.style.display = 'block';
            if (moved.emote.type === 'text') {
              if (em.textContent !== moved.emote.content) {
                em.textContent = moved.emote.content as any;
              }
            } else {
              const src = `/emotes/${moved.emote.content}.svg`;
              // シンプルに入れ替え（XSSリスクは限定的: 固定ディレクトリ）
              if (!em.firstChild || (em.firstChild as HTMLImageElement).getAttribute('src') !== src) {
                em.innerHTML = '';
                const im = document.createElement('img');
                im.src = src;
                em.appendChild(im);
              }
            }
          } else {
            if (em.style.display !== 'none') em.style.display = 'none';
          }
        }
      }

      // 参照(ref)と状態(state)を更新
      const newImageMap = updatedImages.reduce((acc, img) => {
        acc[img.id] = img;
        return acc;
      }, {} as Record<string, AnimatedImage>);

      animatedImagesRef.current = newImageMap;
      // 毎フレームの再レンダリングは行わない

      // 非表示の永続化をバックグラウンドで実行し、画面からは即時非表示
      if (toHide.length > 0) {
        (async () => {
          const { DatabaseService } = await import('../services/database');
          try {
            for (const id of toHide) {
              await DatabaseService.hideImage(id);
              // DOMからは即座に見えなくする
              const div = containerRefs.current.get(id);
              if (div) div.style.display = 'none';
            }
          } catch (e) { console.warn('[AnimationView] hideImage failed', e); }
        })();
      }

      animationRef.current = requestAnimationFrame(animate);
    }

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [moveImage, deletionTime]);

  // 入力画像が変更されたら初期化（DOMは直更新のため、配列はマウント/アンマウント目的に使用）
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
    // レンダー用の配列を更新（DOMノードの生成/破棄のため）
    setAnimatedImages(newImages);
  }, [inputImages, initializeImage]);

  // 地面位置が変更されたら歩くタイプの画像の位置を更新
  useEffect(() => {
    const updatedImages = Object.values(animatedImagesRef.current).map(img => {
      if (img.type === 'walk') {
        // 歩くタイプは新しい地面位置に移動
        return {
          ...img,
          y: groundPosition
        };
      }
      return img;
    });

    animatedImagesRef.current = updatedImages.reduce((acc, img) => {
      acc[img.id] = img;
      return acc;
    }, {} as Record<string, AnimatedImage>);
  }, [groundPosition]);

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
            ref={(el) => {
              if (el) containerRefs.current.set(image.id, el);
              else containerRefs.current.delete(image.id);
            }}
          >
            <img
              ref={(el) => {
                if (el) imgRefs.current.set(image.id, el);
                else imgRefs.current.delete(image.id);
              }}
              src={image.imageUrl}
              alt={image.originalFileName}
              className={`${styles.animatedImage} ${image.movement} ${image.size}`}
              onClick={() => onImageClick?.(image.id)}
            />
            <div
              className={styles.emote}
              ref={(el) => {
                if (el) emoteRefs.current.set(image.id, el);
                else emoteRefs.current.delete(image.id);
              }}
              style={{ display: 'none' }}
            />
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
