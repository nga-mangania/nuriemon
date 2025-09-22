import { AppSettingsService } from './database';

export interface ControllerSettings {
  /**
   * 手動移動の速度係数。1.0 で基準速度、0.5 で半分程度の速度。
   */
  manualSpeedFactor: number;
}

const DEFAULT_SETTINGS: ControllerSettings = {
  manualSpeedFactor: 0.7,
};

const SETTINGS_KEY = 'controller_settings';

function sanitize(settings: Partial<ControllerSettings>): ControllerSettings {
  const factor = settings.manualSpeedFactor;
  const clamped = typeof factor === 'number' && Number.isFinite(factor)
    ? Math.min(2, Math.max(0.2, factor))
    : DEFAULT_SETTINGS.manualSpeedFactor;
  return {
    manualSpeedFactor: clamped,
  };
}

export async function loadControllerSettings(): Promise<ControllerSettings> {
  try {
    const raw = await AppSettingsService.getAppSetting(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return sanitize(parsed);
  } catch (error) {
    console.warn('[controllerSettings] load failed, using default:', error);
    return DEFAULT_SETTINGS;
  }
}

export async function saveControllerSettings(settings: ControllerSettings): Promise<void> {
  const sanitized = sanitize(settings);
  const payload = JSON.stringify(sanitized);
  await AppSettingsService.saveAppSetting(SETTINGS_KEY, payload);
}

export { DEFAULT_SETTINGS as DEFAULT_CONTROLLER_SETTINGS };
