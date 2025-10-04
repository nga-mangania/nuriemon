import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
import {
  DEFAULT_CONTROLLER_SETTINGS,
  loadControllerSettings,
} from '../services/controllerSettings';
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
    backgroundType,
    imageDisplaySize
  } = useWorkspaceStore();

  const baseImageSize = Math.max(8, Math.min(40, imageDisplaySize || 18));
  const containerSizeStyle = useMemo<React.CSSProperties>(() => ({
    width: `${baseImageSize}%`,
    height: `${baseImageSize}%`
  }), [baseImageSize]);
  
  // 表示用のリスト（追加/削除のときだけ更新し、毎フレームは更新しない）
  const [animatedImages, setAnimatedImages] = useState<AnimatedImage[]>([]);
  const animatedImagesRef = useRef<Record<string, AnimatedImage>>({});
  const animationRef = useRef<number>();
  const canvasRef = useRef<HTMLDivElement>(null);
  const backgroundVideoRef = useRef<HTMLVideoElement>(null);
  // DOM 直更新用の参照
  const containerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const imgRefs = useRef<Map<string, HTMLImageElement>>(new Map());
  const emoteRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // ブロードキャスト用エモートキュー
  const emoteBroadcastRef = useRef<null | { type: 'text'|'svg', content: string, pending: string[] }>(null);
  const [controllerSettings, setControllerSettings] = useState(DEFAULT_CONTROLLER_SETTINGS);

  // ノイズ簡易キャッシュ・負荷制御用の可変パラメータ
  const noiseIntervalMsRef = useRef(66);   // 約15Hz（重い時は100msへ）
  const emoteBatchSizeRef = useRef(8);     // 1フレームあたりのエモート適用数
  const specialProbRef = useRef(0.0995);   // 特殊動作の発火確率
  const perfModeRef = useRef<'normal'|'degraded'>('normal');
  const emaRef = useRef(0);                // フレーム時間のEMA
  const aboveRef = useRef(0);              // 閾値上超過カウンタ
  const belowRef = useRef(0);              // 閾値下回復カウンタ
  
  // 線形補間
  const lerp = useCallback((a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t)), []);

  // ノイズを一定間隔でサンプリングし補間して返す
  const getSmoothedNoise = useCallback((img: any, now: number) => {
    if (img.noisePrevT == null) {
      const sX = noise2D(now * 0.001 + img.offset, 0);
      const sY = noise2D(now * 0.001 + img.offset + 1000, 0);
      img.noisePrevX = sX; img.noisePrevY = sY;
      img.noiseNextX = sX; img.noiseNextY = sY;
      const interval = noiseIntervalMsRef.current;
      img.noisePrevT = now; img.noiseNextT = now + interval;
    }
    if (now >= img.noiseNextT) {
      img.noisePrevX = img.noiseNextX; img.noisePrevY = img.noiseNextY;
      img.noisePrevT = img.noiseNextT;
      const t = now * 0.001;
      img.noiseNextX = noise2D(t + img.offset, 0);
      img.noiseNextY = noise2D(t + img.offset + 1000, 0);
      const interval = noiseIntervalMsRef.current;
      img.noiseNextT = img.noisePrevT + interval;
    }
    const u = (now - img.noisePrevT) / (img.noiseNextT - img.noisePrevT);
    return {
      x: lerp(img.noisePrevX, img.noiseNextX, u),
      y: lerp(img.noisePrevY, img.noiseNextY, u),
    };
  }, [lerp]);
  
  // デバッグログ：地面位置の確認
  useEffect(() => {
    console.log('[AnimationView] 地面位置が変更されました:', groundPosition);
  }, [groundPosition]);

  useEffect(() => {
    let mounted = true;
    loadControllerSettings().then((settings) => {
      if (mounted) setControllerSettings(settings);
    });
    const unlistenPromise = listen('app-settings-changed', async (event) => {
      const payload: any = event.payload;
      if (payload?.key === 'controller_settings') {
        const updated = await loadControllerSettings();
        setControllerSettings(updated);
      }
    });
    return () => {
      mounted = false;
      unlistenPromise.then((un) => { try { un(); } catch (_) {} }).catch(() => {});
    };
  }, []);

  const ensureBackgroundVideoPlaying = useCallback(() => {
    const video = backgroundVideoRef.current;
    if (!video) {
      return;
    }
    if (video.readyState >= 2 && video.paused) {
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch((err) => {
          console.warn('[AnimationView] 背景動画の自動再生に失敗しました', err);
        });
      }
    } else if (video.paused) {
      const handler = () => {
        video.removeEventListener('canplay', handler);
        requestAnimationFrame(() => ensureBackgroundVideoPlaying());
      };
      video.addEventListener('canplay', handler, { once: true });
    }
  }, []);

  useEffect(() => {
    if (backgroundType !== 'video' || !backgroundUrl) {
      return;
    }
    ensureBackgroundVideoPlaying();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        ensureBackgroundVideoPlaying();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    const video = backgroundVideoRef.current;
    const onPause = () => {
      ensureBackgroundVideoPlaying();
    };
    if (video) {
      video.addEventListener('pause', onPause);
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (video) {
        video.removeEventListener('pause', onPause);
      }
    };
  }, [backgroundType, backgroundUrl, ensureBackgroundVideoPlaying]);

  const applyManualControl = useCallback((img: AnimatedImage, direction?: string, rawAction?: string) => {
    const action = (rawAction || 'hold').toLowerCase();
    const currentX = img.manualAxisX ?? 0;
    const currentY = img.manualAxisY ?? 0;

    const resetIfIdle = () => {
      if ((img.manualAxisX ?? 0) === 0 && (img.manualAxisY ?? 0) === 0) {
        img.velocityX = 0;
        img.velocityY = 0;
        img.directionChangeTimer = Math.random() * 60 + 45;
        img.nextMovementUpdate = Date.now() + 600;
      }
    };

    if (action === 'stop' && (!direction || direction === 'all')) {
      img.manualAxisX = 0;
      img.manualAxisY = 0;
      resetIfIdle();
      return;
    }

    if (!direction) {
      return;
    }

    switch (action) {
      case 'start':
      case 'hold': {
        if (direction === 'left') {
          img.manualAxisX = -1;
          img.flipped = true;
          img.velocityX = 0;
        } else if (direction === 'right') {
          img.manualAxisX = 1;
          img.flipped = false;
          img.velocityX = 0;
        } else if (direction === 'up') {
          img.manualAxisY = -1;
          img.velocityY = 0;
        } else if (direction === 'down') {
          img.manualAxisY = 1;
          img.velocityY = 0;
        }
        img.directionChangeTimer = Math.max(img.directionChangeTimer, 45);
        break;
      }
      case 'stop': {
        if (direction === 'left' && currentX < 0) {
          img.manualAxisX = 0;
        } else if (direction === 'right' && currentX > 0) {
          img.manualAxisX = 0;
        } else if (direction === 'up' && currentY < 0) {
          img.manualAxisY = 0;
        } else if (direction === 'down' && currentY > 0) {
          img.manualAxisY = 0;
        } else if (direction === 'all') {
          img.manualAxisX = 0;
          img.manualAxisY = 0;
        }
        resetIfIdle();
        break;
      }
      case 'pulse': {
        const accel = 0.18;
        const clamp = (v: number, max: number) => Math.max(-max, Math.min(max, v));
        if (direction === 'left') {
          img.velocityX = clamp((img.velocityX || 0) - accel, 2.2);
        } else if (direction === 'right') {
          img.velocityX = clamp((img.velocityX || 0) + accel, 2.2);
        } else if (direction === 'up') {
          img.velocityY = clamp((img.velocityY || 0) - accel, 2.2);
        } else if (direction === 'down') {
          img.velocityY = clamp((img.velocityY || 0) + accel, 2.2);
        }
        img.manualAxisX = 0;
        img.manualAxisY = 0;
        break;
      }
      default:
        break;
    }
  }, []);

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
            const action = payload.action as string | undefined;
            apply((img) => {
              applyManualControl(img, dir, action);
              img.lastMovementUpdate = Date.now();
              img.isNewImage = false;
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
            if (!emoteType) break;
            const allowed = new Set(svgEmotes);
            const asType: 'svg'|'text' = allowed.has(emoteType) ? 'svg' : 'text';
            if (imageId) {
              apply((img) => {
                img.emote = { type: asType, content: emoteType } as any;
                img.emoteTimer = 150;
              });
            } else {
              // 全体へ負荷分散で適用（1フレームあたり最大12件）
              const ids = Object.keys(animatedImagesRef.current);
              emoteBroadcastRef.current = { type: asType, content: emoteType, pending: ids.slice() };
            }
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
      const p = specialProbRef.current;
      if (image.specialMovementCooldown <= 0 && Math.random() < p) {
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
  const initializeImage = useCallback((data: any, markAsNew: boolean): AnimatedImage => {
    const now = Date.now();
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
      createdAt: now, // 画像が作成された時刻を記録
      deletionTime: deletionTime, // 現在の削除時間設定を適用
      rotation: 0,
      zRotation: 0,
      flipped: false,
      directionChangeTimer: Math.random() * 200 + 100,
      offset: Math.random() * 10000,
      phaseOffset: Math.random() * Math.PI * 2,
      lastMovementUpdate: now,
      nextMovementUpdate: now + Math.random() * 5000,
      globalScale: 1,
      scaleDirection: Math.random() < 0.5 ? 1 : -1,
      scaleSpeed: Math.random() * 0.001 + 0.0005,
      animationStartTime: now,
      isNewImage: markAsNew,
      pendingDeletion: false,
      specialMovementCooldown: 0,
      specialScale: 1,
      manualAxisX: 0,
      manualAxisY: 0,
      highlightEffect: markAsNew ? { startTime: now, duration: 1600 } : null,
      highlightScale: markAsNew ? 1.6 : 1,
      highlightGlow: markAsNew ? 0.9 : 0,
      highlightOpacity: markAsNew ? 0.05 : 1,
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

    const manualAxisX = image.manualAxisX ?? 0;
    const manualAxisY = image.manualAxisY ?? 0;
    const manualActive = manualAxisX !== 0 || manualAxisY !== 0;
    const speedFactor = Math.min(2, Math.max(0.2, controllerSettings.manualSpeedFactor));
    const manualSpeedBase = manualActive ? (0.9 * currentSpeed + 0.35) * speedFactor : 0;
    const manualHorizontal = manualAxisX * manualSpeedBase;
    const manualVertical = manualAxisY * (image.type === 'fly' ? manualSpeedBase : manualSpeedBase * 0.6);

    const noiseScale = manualActive ? 0 : 0.05;
    const sm = getSmoothedNoise(image as any, currentTime);
    const noiseX = sm.x * noiseScale * currentSpeed;
    const noiseY = sm.y * noiseScale * currentSpeed;

    if (image.type === "walk") {
      image.y = groundPosition;
      const baseX = manualActive ? 0 : scaledVelocityX;
      image.x += baseX + noiseX + manualHorizontal;
      if (manualAxisX < 0) {
        image.flipped = true;
      } else if (manualAxisX > 0) {
        image.flipped = false;
      }

      if (image.x <= -5 || image.x >= 95) {
        image.x = Math.max(-5, Math.min(95, image.x));
        if (!manualActive) {
          image.velocityX *= -1;
          image.flipped = !image.flipped;
        }
      }
    } else if (image.type === "fly") {
      const baseX = manualActive ? 0 : scaledVelocityX;
      const baseY = manualActive ? 0 : scaledVelocityY;
      image.x += baseX + noiseX + manualHorizontal;
      image.y += baseY + noiseY + manualVertical;

      if (manualAxisX < 0) {
        image.flipped = true;
      } else if (manualAxisX > 0) {
        image.flipped = false;
      }

      if (image.x <= -5 || image.x >= 95) {
        image.x = Math.max(-5, Math.min(95, image.x));
        if (!manualActive) {
          image.velocityX *= -1;
          image.flipped = !image.flipped;
        }
      }

      const maxHeight = 5;
      const minHeight = groundPosition;

      if (image.y <= maxHeight || image.y >= minHeight) {
        image.y = Math.max(maxHeight, Math.min(minHeight, image.y));
        if (!manualActive) {
          image.velocityY *= -1;
        }
      }
    }

    // 方向変更
    if (manualActive) {
      image.directionChangeTimer = Math.max(image.directionChangeTimer, 45);
    } else {
      image.directionChangeTimer -= 1;
      if (image.directionChangeTimer <= 0) {
        image.velocityX = (Math.random() - 0.5) * 1;
        image.velocityY = (Math.random() - 0.5) * 1;
        image.directionChangeTimer = Math.random() * 50 + 25;
      }
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

      if (!manualActive) {
        image.x += x;
        image.y += y;
      }

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
  }, [groundPosition, applySpecialMovement, controllerSettings.manualSpeedFactor]);

  // アニメーションループ
  useEffect(() => {
    function animate() {
      const frameStart = performance.now();
      const currentTime = Date.now();
      // エモートのブロードキャストを分割して適用
      const bc = emoteBroadcastRef.current;
      if (bc && bc.pending.length > 0) {
        const batchSize = emoteBatchSizeRef.current;
        const batch = bc.pending.splice(0, batchSize);
        for (const id of batch) {
          const img = animatedImagesRef.current[id];
          if (!img) continue;
          (img as any).emote = { type: bc.type, content: bc.content } as any;
          (img as any).emoteTimer = 150;
        }
        if (bc.pending.length === 0) {
          emoteBroadcastRef.current = null;
        }
      }
      const updatedImages: AnimatedImage[] = [];
      
      const deletionTimeMs = (deletionTime !== 'unlimited')
        ? parseInt(deletionTime) * 60 * 1000
        : -1;

      // 非表示の永続化: 一度だけhide APIを叩くためのセット
      const toHide: string[] = [];

      for (const image of Object.values(animatedImagesRef.current)) {
        if (image.pendingDeletion) {
          continue;
        }
        // 削除チェック
        if (deletionTimeMs > 0 && image.createdAt && currentTime - image.createdAt >= deletionTimeMs) {
          console.log(`[AnimationView] 画像 ${image.id} を非表示（時間経過）`);
          image.pendingDeletion = true;
          toHide.push(image.id);
          continue; // この画像は更新リストに追加しない（アニメ画面から消す）
        }

        // 画像の移動処理
        const moved = moveImage(image);

        if (moved.highlightEffect) {
          const effect = moved.highlightEffect;
          const duration = Math.max(effect.duration || 1, 1);
          const elapsed = currentTime - effect.startTime;
          if (elapsed >= duration) {
            moved.highlightEffect = null;
            moved.highlightScale = 1;
            moved.highlightGlow = 0;
            moved.highlightOpacity = 1;
          } else {
            const t = Math.max(0, Math.min(1, elapsed / duration));
            const pulse = Math.sin(t * Math.PI);
            moved.highlightScale = 1 + 0.3 * (1 - t) + 0.2 * pulse;
            moved.highlightGlow = Math.max(0, 0.75 * (1 - t));
            const fadeIn = Math.min(1, t / 0.2);
            moved.highlightOpacity = 0.6 + 0.4 * fadeIn;
          }
        } else {
          moved.highlightScale = moved.highlightScale ?? 1;
          moved.highlightGlow = moved.highlightGlow ?? 0;
          moved.highlightOpacity = moved.highlightOpacity ?? 1;
        }

        updatedImages.push(moved);
        // DOMへスタイル反映（transform移動＋回転・スケール）
        const div = containerRefs.current.get(moved.id);
        if (div) {
          const t = `translate3d(${moved.x}vw, ${moved.y}vh, 0) translate(-50%, -50%) perspective(500px) ${moved.zRotation ? `rotateY(${moved.zRotation}deg)` : ''}`;
          if (div.style.transform !== t) div.style.transform = t;
          if (div.style.display !== '') div.style.display = '';
          const glow = moved.highlightGlow ?? 0;
          if (glow > 0) {
            const blur = (12 + glow * 28).toFixed(1);
            const alpha = Math.min(1, 0.55 + glow * 0.35).toFixed(2);
            const filter = `drop-shadow(0 0 ${blur}px rgba(255,255,255,${alpha}))`;
            if (div.style.filter !== filter) div.style.filter = filter;
          } else if (div.style.filter !== '') {
            div.style.filter = '';
          }
          const opacity = moved.highlightOpacity ?? 1;
          const opacityStr = opacity >= 0.999 ? '' : String(opacity);
          if (div.style.opacity !== opacityStr) div.style.opacity = opacityStr;
        }
        const imgEl = imgRefs.current.get(moved.id);
        if (imgEl) {
          const highlightScale = moved.highlightScale ?? 1;
          const sx = (moved.scaleX || 1) * (moved.specialScale || 1) * highlightScale;
          const sy = (moved.scaleY || 1) * (moved.specialScale || 1) * highlightScale;
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
              // firstElementChildが<IMG>か確認し、異なる場合のみ差し替え
              const currentImg = em.firstElementChild as HTMLImageElement | null;
              const currentSrc = currentImg && typeof currentImg.getAttribute === 'function' ? currentImg.getAttribute('src') : null;
              if (!currentImg || currentSrc !== src) {
                em.textContent = '';
                const im = document.createElement('img');
                im.src = src;
                im.decoding = 'async';
                im.loading = 'eager';
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
              await DatabaseService.deleteImage(id, 'auto');
              const div = containerRefs.current.get(id);
              if (div) div.style.display = 'none';
            }
          } catch (e) { console.warn('[AnimationView] auto delete failed', e); }
        })();
      }

      // パフォーマンス監視（EMA / ヒステリシス）
      const dt = performance.now() - frameStart;
      const ema = emaRef.current = emaRef.current * 0.9 + dt * 0.1;
      const mode = perfModeRef.current;
      if (mode === 'normal') {
        if (ema > 14) {
          aboveRef.current += 1; belowRef.current = 0;
          if (aboveRef.current > 30) {
            perfModeRef.current = 'degraded';
            noiseIntervalMsRef.current = 100;
            emoteBatchSizeRef.current = 6;
            specialProbRef.current = 0.05;
            aboveRef.current = 0; belowRef.current = 0;
          }
        } else if (ema < 10) {
          aboveRef.current = 0; belowRef.current = 0;
        }
      } else {
        if (ema < 8) {
          belowRef.current += 1; aboveRef.current = 0;
          if (belowRef.current > 60) {
            perfModeRef.current = 'normal';
            noiseIntervalMsRef.current = 66;
            emoteBatchSizeRef.current = 8;
            specialProbRef.current = 0.0995;
            aboveRef.current = 0; belowRef.current = 0;
          }
        } else if (ema > 16) {
          belowRef.current = 0;
        }
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
        existing.imageUrl = img.imageUrl;
        existing.originalFileName = img.originalFileName;
        existing.type = img.type;
        existing.movement = img.movement;
        existing.size = img.size;
        existing.speed = img.speed;
        existing.isNewImage = false;
        existing.pendingDeletion = false;
        return existing;
      }
      // 新しい画像を初期化
      return initializeImage(img, true);
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
          ref={backgroundVideoRef}
          src={backgroundUrl}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          onLoadedData={ensureBackgroundVideoPlaying}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            zIndex: 0
          }}
          onError={(e) => {
            console.error('[AnimationView] Background video load error', e);
            console.error('[AnimationView] URL:', backgroundUrl);
          }}
        />
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
            style={containerSizeStyle}
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
