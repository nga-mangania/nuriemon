import { DatabaseService, MovementSettings } from './database';

/**
 * 動き設定を保存
 */
export async function saveMovementSettings(
  imageId: string,
  settings: {
    type: string;
    movement: string;
    speed: number;
    size: string;
  }
): Promise<void> {
  const timestamp = new Date().toISOString();
  
  const movementSettings: MovementSettings = {
    image_id: imageId,
    movement_type: settings.type,
    movement_pattern: settings.movement,
    speed: settings.speed,
    size: settings.size,
    created_at: timestamp,
    updated_at: timestamp
  };

  await DatabaseService.saveMovementSettings(movementSettings);
}

/**
 * 動き設定を取得
 */
export async function getMovementSettings(imageId: string): Promise<{
  type: string;
  movement: string;
  speed: number;
  size: string;
} | null> {
  const settings = await DatabaseService.getMovementSettings(imageId);
  
  if (!settings) {
    return null;
  }

  return {
    type: settings.movement_type,
    movement: settings.movement_pattern,
    speed: settings.speed,
    size: settings.size
  };
}

/**
 * すべての動き設定を取得（画像IDをキーとしたマップ）
 */
export async function getAllMovementSettings(): Promise<Map<string, {
  type: string;
  movement: string;
  speed: number;
  size: string;
}>> {
  const allSettings = await DatabaseService.getAllMovementSettings();
  const settingsMap = new Map();

  for (const settings of allSettings) {
    settingsMap.set(settings.image_id, {
      type: settings.movement_type,
      movement: settings.movement_pattern,
      speed: settings.speed,
      size: settings.size
    });
  }

  return settingsMap;
}

/**
 * 動き設定を更新
 */
export async function updateMovementSettings(
  imageId: string,
  settings: {
    type: string;
    movement: string;
    speed: number;
    size: string;
  }
): Promise<void> {
  const existingSettings = await DatabaseService.getMovementSettings(imageId);
  const timestamp = new Date().toISOString();
  
  const movementSettings: MovementSettings = {
    image_id: imageId,
    movement_type: settings.type,
    movement_pattern: settings.movement,
    speed: settings.speed,
    size: settings.size,
    created_at: existingSettings?.created_at || timestamp,
    updated_at: timestamp
  };

  await DatabaseService.saveMovementSettings(movementSettings);
}