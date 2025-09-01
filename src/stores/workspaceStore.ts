// src/stores/workspaceStore.ts

import { create } from 'zustand';
import { load } from '@tauri-apps/plugin-store';
import { ImageMetadata } from '../services/imageStorage';
import { emit } from '@tauri-apps/api/event';

// ストアのインスタンスは一度だけ生成
let storeInstance: any = null;
const getStore = async () => {
  if (!storeInstance) {
    storeInstance = await load('.nuriemon-settings.dat', { autoSave: false });
  }
  return storeInstance;
};

interface WorkspaceState {
  currentWorkspace: string | null;
  groundPosition: number;
  deletionTime: string;
  backgroundUrl: string | null;
  backgroundType: 'image' | 'video';
  settings: any | null;
  isLoading: boolean;
  images: ImageMetadata[];

  // アクション
  setCurrentWorkspace: (path: string | null) => void;
  setGroundPosition: (position: number) => void;
  setDeletionTime: (time: string) => void;
  setBackground: (url: string | null, type: 'image' | 'video') => void;
  setSettings: (settings: any) => void;
  updateSettings: (partialSettings: Partial<any>) => void;
  setLoading: (loading: boolean) => void;
  resetStore: () => void;
  setImages: (images: ImageMetadata[]) => void;
}

// --- 手動同期のためのヘルパー関数 ---
// この関数はストアの外部にあるため、どのストアのアクションからも呼び出せる
let lastSaveTs = 0;
let saveTimer: number | null = null as any;
async function saveStateToFile() {
  try {
    const now = Date.now();
    // 1秒以内の連続保存はまとめる
    if (saveTimer) {
      return;
    }
    if (now - lastSaveTs < 1000) {
      saveTimer = window.setTimeout(async () => {
        saveTimer = null as any;
        await doSave();
      }, 1000 - (now - lastSaveTs));
      return;
    }
    await doSave();
  } catch (error) {
    console.error('Failed to save state to store:', error);
  }
}

async function doSave() {
  const store = await getStore();
  const state = useWorkspaceStore.getState();
  await store.set('workspace', {
    currentWorkspace: state.currentWorkspace,
    images: state.images,
    groundPosition: state.groundPosition,
    deletionTime: state.deletionTime,
  });
  await store.save();
  lastSaveTs = Date.now();
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  currentWorkspace: null,
  groundPosition: 80,
  deletionTime: 'unlimited',
  backgroundUrl: null,
  backgroundType: 'image',
  settings: null,
  isLoading: false,
  images: [],

  // --- アクション ---
  setCurrentWorkspace: (path) => {
    set({ currentWorkspace: path });
    // 重要な変更のみ保存
    saveStateToFile();
  },
  
  setGroundPosition: (position) => {
    set((state) => {
      const newSettings = state.settings ? { ...state.settings, groundPosition: position } : null;
      return {
        groundPosition: position,
        settings: newSettings
      };
    });
  },
  
  setDeletionTime: (time) => {
    set((state) => {
      const newSettings = state.settings ? { ...state.settings, deletionTime: time } : null;
      return {
        deletionTime: time,
        settings: newSettings
      };
    });
  },
  
  setBackground: (url, type) => {
    set({ 
      backgroundUrl: url, 
      backgroundType: type 
    });
    // 背景は保存対象外なので saveStateToFile は呼ばない
  },
  
  setSettings: (settings) => {
    set({
      settings,
      groundPosition: settings.groundPosition || 80,
      deletionTime: settings.deletionTime || 'unlimited',
      currentWorkspace: settings.customPath
    });
  },
  
  updateSettings: (partialSettings) => {
    set((state) => {
      if (!state.settings) return state;
      
      const newSettings = { ...state.settings, ...partialSettings };
      return {
        settings: newSettings,
        groundPosition: partialSettings.groundPosition ?? state.groundPosition,
        deletionTime: partialSettings.deletionTime ?? state.deletionTime
      };
    });
  },
  
  setLoading: (loading) => {
    set({ isLoading: loading });
    // ローディング状態は保存対象外
  },
  
  resetStore: () => {
    set({
      currentWorkspace: null,
      groundPosition: 80,
      deletionTime: 'unlimited',
      backgroundUrl: null,
      backgroundType: 'image',
      settings: null,
      isLoading: false,
      images: []
    });
  },

  setImages: (images) => {
    set({ images });
    // 画像リストの更新は重要なので保存
    saveStateToFile();
  },
}));

// ファイルから状態を読み込む関数 (これは変更なし)
export async function loadStateFromFile() {
  try {
    const store = await getStore();
    const stateFromFile = await store.get<{
      currentWorkspace: string | null;
      images: ImageMetadata[];
      groundPosition: number;
      deletionTime: string;
    }>('workspace');
    
    if (stateFromFile) {
      useWorkspaceStore.setState(stateFromFile);
      console.log('[loadStateFromFile] State loaded from store:', stateFromFile);
    }
  } catch (error) {
    console.error('Failed to load state from store:', error);
  }
}

// 旧関数名との互換性のため
export const rehydrateStore = loadStateFromFile;
