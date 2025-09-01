import { invoke } from '@tauri-apps/api/core';

export class GlobalSettingsService {
  static async save(key: string, value: string): Promise<void> {
    await invoke('save_global_setting', { key, value });
  }

  static async get(key: string): Promise<string | null> {
    try {
      const value = await invoke<string | null>('get_global_setting', { key });
      return value ?? null;
    } catch (e) {
      console.error('[GlobalSettingsService] get error:', e);
      return null;
    }
  }
}

