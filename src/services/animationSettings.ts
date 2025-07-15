import { createNoise2D } from 'simplex-noise';

const noise2D = createNoise2D();

export const SPEED_SETTINGS = {
  slow: 0.3,
  medium: 0.5,
  fast: 0.7,
};

export const SIZE_SETTINGS = {
  small: 0.5,
  medium: 1,
  large: 1.5,
};

export interface MovementSettings {
  x?: number;
  y?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
}

export const MOVEMENT_SETTINGS: Record<string, (time: number, amplitude: number, offset?: number, phaseOffset?: number) => MovementSettings> = {
  normal: (time, amplitude, offset = 0, phaseOffset = 0) => ({
    x: noise2D(time * 0.001 + offset, phaseOffset) * amplitude * 0.1,
    y: noise2D(time * 0.001 + offset + 1000, phaseOffset) * amplitude * 0.1,
  }),
  sway: (time, amplitude, offset = 0, phaseOffset = 0) => ({
    x:
      Math.sin((time + offset) * 0.002 + phaseOffset) * amplitude * 0.03 +
      noise2D(time * 0.001 + offset, phaseOffset) * amplitude * 0.05,
    y: noise2D(time * 0.001 + offset + 1000, phaseOffset) * amplitude * 0.05,
  }),
  spin: (time, amplitude, offset = 0, phaseOffset = 0) => {
    const baseRotationSpeed = 1000;
    const rotationSpeed = baseRotationSpeed * (1 + amplitude);
    return {
      rotation:
        ((((time + offset) * rotationSpeed) / 1000 + phaseOffset) % 360) +
        noise2D(time * 0.001 + offset, phaseOffset) * 10,
    };
  },
  stretch: (time, amplitude, offset = 0, phaseOffset = 0) => {
    const stretch =
      Math.sin((time + offset) * 0.002 + phaseOffset) * 0.4 * amplitude +
      1 +
      noise2D(time * 0.001 + offset, phaseOffset) * 0.5;
    return {
      scaleX: stretch,
      scaleY: 1 / stretch,
      x: noise2D(time * 0.001 + offset + 2000, phaseOffset) * amplitude * 0.3,
      y: noise2D(time * 0.001 + offset + 3000, phaseOffset) * amplitude * 0.3,
    };
  },
  vibrate: (time, amplitude, offset = 0, phaseOffset = 0) => {
    const frequency = 0.5; // 振動の頻度
    const vibrateAmount = amplitude * 0.15; // 振動の大きさ
    return {
      x: Math.sin((time + offset) * frequency + phaseOffset) * vibrateAmount,
      y:
        Math.cos((time + offset) * frequency + phaseOffset + 1000) *
        vibrateAmount,
      rotation: Math.sin((time + offset) * frequency * 1.5 + phaseOffset) * 2,
    };
  },
  tilt: (time, amplitude, offset = 0, phaseOffset = 0) => {
    const tiltFrequency = 0.005; // 傾きの速さを調整
    const tiltAngle = Math.sin((time + offset) * tiltFrequency + phaseOffset) * amplitude * 15; // 傾きの角度を計算
    return {
      rotation: tiltAngle,
    };
  },
};

// 動きの名前マッピング
export const movementNames: Record<string, string> = {
  normal: "ふつう",
  sway: "ゆらゆら",
  spin: "ぐるぐる",
  stretch: "びょーん",
  vibrate: "ぶるぶる",
  tilt: "かたむく",
};

// サイズの名前マッピング
export const sizeNames: Record<string, string> = {
  small: "ちいさい",
  medium: "ふつう",
  large: "おおきい",
};

// タイプの名前マッピング
export const typeNames: Record<string, string> = {
  walk: "地上",
  fly: "浮遊",
};

// エモート定義
export const textEmotes = [
  "❤️",
  "⭐",
  "✨",
  "😊",
  "😂",
  "🥰",
  "😍",
  "🎵",
  "💖",
  "🌟",
  "🎈",
  "🌈",
  "💭",
];

export const svgEmotes = ["good", "Hello", "hi", "wow"];

// アニメーション画像の型定義
export interface AnimatedImage {
  id: string;
  imageUrl: string;
  originalFileName: string;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  scale: number;
  scaleX?: number;
  scaleY?: number;
  rotation: number;
  zRotation?: number;
  flipped: boolean;
  type: 'walk' | 'fly';
  movement: string;
  size: string;
  speed: number;
  directionChangeTimer: number;
  offset: number;
  phaseOffset: number;
  lastMovementUpdate: number;
  nextMovementUpdate: number;
  globalScale: number;
  scaleDirection: number;
  scaleSpeed: number;
  animationStartTime: number;
  isNewImage: boolean;
  animationCompleted?: boolean;
  specialMovement?: SpecialMovement | null;
  specialMovementCooldown: number;
  specialScale?: number;
  emote?: Emote | null;
  emoteTimer?: number;
  lastUpdateTime?: number;
}

export interface SpecialMovement {
  type: number;
  startTime: number;
  duration: number;
  originalVelocityX: number;
  originalVelocityY: number;
  originalY: number;
}

export interface Emote {
  type: 'text' | 'svg';
  content: string;
}