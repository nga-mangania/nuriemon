// src/stores/workspaceStore.ts

import { create } from 'zustand';
import { load } from '@tauri-apps/plugin-store';

export interface WorkspaceImage {
  id: string;
  originalFileName: string;
  savedFileName: string;
  createdAt: string;
  displayStartedAt: string | null;
}

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
  processedImages: WorkspaceImage[];
  processedCursor: number | null;
  imageDisplaySize: number;

  // アクション
  setCurrentWorkspace: (path: string | null) => void;
  setGroundPosition: (position: number) => void;
  setDeletionTime: (time: string) => void;
  setBackground: (url: string | null, type: 'image' | 'video') => void;
  setSettings: (settings: any) => void;
  updateSettings: (partialSettings: Partial<any>) => void;
  setLoading: (loading: boolean) => void;
  resetStore: () => void;
  setProcessedImages: (images: WorkspaceImage[]) => void;
  upsertProcessedImage: (image: WorkspaceImage) => void;
  removeProcessedImage: (id: string) => void;
  setProcessedCursor: (cursor: number | null) => void;
  setImageDisplaySize: (size: number) => void;
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
    images: state.processedImages,
    groundPosition: state.groundPosition,
    deletionTime: state.deletionTime,
    imageDisplaySize: state.imageDisplaySize,
    processedCursor: state.processedCursor,
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
  processedImages: [],
  processedCursor: null,
  imageDisplaySize: 18,

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
    set((state) => ({
      settings,
      groundPosition: settings.groundPosition || 80,
      deletionTime: settings.deletionTime || 'unlimited',
      currentWorkspace: settings.customPath,
      imageDisplaySize: typeof settings.imageDisplaySize === 'number'
        ? settings.imageDisplaySize
        : state.imageDisplaySize ?? 18
    }));
  },
  
  updateSettings: (partialSettings) => {
    set((state) => {
      if (!state.settings) return state;
      
      const newSettings = { ...state.settings, ...partialSettings };
      return {
        settings: newSettings,
        groundPosition: partialSettings.groundPosition ?? state.groundPosition,
        deletionTime: partialSettings.deletionTime ?? state.deletionTime,
        imageDisplaySize: typeof partialSettings.imageDisplaySize === 'number' ? partialSettings.imageDisplaySize : state.imageDisplaySize
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
      processedImages: [],
      processedCursor: null,
      imageDisplaySize: 18
    });
  },

  setProcessedImages: (images) => {
    set({ processedImages: images });
    saveStateToFile();
  },

  upsertProcessedImage: (image) => {
    set((state) => {
      const existingIndex = state.processedImages.findIndex(item => item.id === image.id);
      let next: WorkspaceImage[];
      if (existingIndex >= 0) {
        next = state.processedImages.slice();
        next[existingIndex] = image;
      } else {
        next = [...state.processedImages, image];
      }
      next.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return { processedImages: next };
    });
    saveStateToFile();
  },

  removeProcessedImage: (id) => {
    set((state) => ({ processedImages: state.processedImages.filter(img => img.id !== id) }));
    saveStateToFile();
  },

  setProcessedCursor: (cursor) => {
    set({ processedCursor: cursor });
    saveStateToFile();
  },

  setImageDisplaySize: (size) => {
    set({ imageDisplaySize: size });
    saveStateToFile();
  },
}));

// ファイルから状態を読み込む関数 (これは変更なし)
export async function loadStateFromFile() {
  try {
    const store = await getStore();
    const stateFromFile = (await store.get('workspace')) as {
      currentWorkspace: string | null;
      images: WorkspaceImage[];
      groundPosition: number;
      deletionTime: string;
      imageDisplaySize?: number;
      processedCursor?: number | null;
    } | null;
    
    if (stateFromFile) {
      useWorkspaceStore.setState({
        currentWorkspace: stateFromFile.currentWorkspace,
        processedImages: stateFromFile.images || [],
        groundPosition: stateFromFile.groundPosition,
        deletionTime: stateFromFile.deletionTime,
        imageDisplaySize: typeof stateFromFile.imageDisplaySize === 'number' ? stateFromFile.imageDisplaySize : 18,
        processedCursor: typeof stateFromFile.processedCursor === 'number' ? stateFromFile.processedCursor : null,
        backgroundUrl: null,
        backgroundType: 'image',
        settings: null,
        isLoading: false,
      });
      console.log('[loadStateFromFile] State loaded from store:', stateFromFile);
    }
  } catch (error) {
    console.error('Failed to load state from store:', error);
  }
}

// 旧関数名との互換性のため
export const rehydrateStore = loadStateFromFile;
