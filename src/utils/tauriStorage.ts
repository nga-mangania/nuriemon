import { StateStorage } from 'zustand/middleware';
import { load } from '@tauri-apps/plugin-store';

// ストアインスタンスをキャッシュ
let storeInstance: any = null;

const getStore = async () => {
  if (!storeInstance) {
    storeInstance = await load('.nuriemon-settings.dat', { autoSave: false });
  }
  return storeInstance;
};

export const tauriStorage: StateStorage = {
  getItem: async (name: string) => {
    try {
      const store = await getStore();
      const value = await store.get(name);
      return value ? JSON.stringify(value) : null;
    } catch (error) {
      console.error('[tauriStorage] Failed to get item:', error);
      return null;
    }
  },
  setItem: async (name: string, value: string) => {
    try {
      const store = await getStore();
      const parsed = JSON.parse(value);
      await store.set(name, parsed);
      await store.save();
    } catch (error) {
      console.error('[tauriStorage] Failed to set item:', error);
    }
  },
  removeItem: async (name: string) => {
    try {
      const store = await getStore();
      await store.delete(name);
      await store.save();
    } catch (error) {
      console.error('[tauriStorage] Failed to remove item:', error);
    }
  },
};
