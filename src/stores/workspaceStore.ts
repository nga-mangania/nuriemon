import { create } from 'zustand';
import { WorkspaceSettings } from '../services/workspaceManager';

interface WorkspaceStore {
  // 状態
  currentWorkspace: string | null;
  groundPosition: number;
  deletionTime: string;
  backgroundUrl: string | null;
  backgroundType: 'image' | 'video';
  settings: WorkspaceSettings | null;
  isLoading: boolean;

  // アクション
  setCurrentWorkspace: (path: string | null) => void;
  setGroundPosition: (position: number) => void;
  setDeletionTime: (time: string) => void;
  setBackground: (url: string | null, type: 'image' | 'video') => void;
  setSettings: (settings: WorkspaceSettings) => void;
  updateSettings: (partialSettings: Partial<WorkspaceSettings>) => void;
  setLoading: (loading: boolean) => void;
  resetStore: () => void;
}

/**
 * ワークスペース設定のグローバル状態管理ストア
 */
export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  // 初期状態
  currentWorkspace: null,
  groundPosition: 80,
  deletionTime: 'unlimited',
  backgroundUrl: null,
  backgroundType: 'image',
  settings: null,
  isLoading: false,

  // アクション
  setCurrentWorkspace: (path) => set({ currentWorkspace: path }),
  
  setGroundPosition: (position) => set((state) => {
    const newSettings = state.settings ? { ...state.settings, groundPosition: position } : null;
    return {
      groundPosition: position,
      settings: newSettings
    };
  }),
  
  setDeletionTime: (time) => set((state) => {
    const newSettings = state.settings ? { ...state.settings, deletionTime: time } : null;
    return {
      deletionTime: time,
      settings: newSettings
    };
  }),
  
  setBackground: (url, type) => set({ 
    backgroundUrl: url, 
    backgroundType: type 
  }),
  
  setSettings: (settings) => set({
    settings,
    groundPosition: settings.groundPosition || 80,
    deletionTime: settings.deletionTime || 'unlimited',
    currentWorkspace: settings.customPath
  }),
  
  updateSettings: (partialSettings) => set((state) => {
    if (!state.settings) return state;
    
    const newSettings = { ...state.settings, ...partialSettings };
    return {
      settings: newSettings,
      groundPosition: partialSettings.groundPosition ?? state.groundPosition,
      deletionTime: partialSettings.deletionTime ?? state.deletionTime
    };
  }),
  
  setLoading: (loading) => set({ isLoading: loading }),
  
  resetStore: () => set({
    currentWorkspace: null,
    groundPosition: 80,
    deletionTime: 'unlimited',
    backgroundUrl: null,
    backgroundType: 'image',
    settings: null,
    isLoading: false
  })
}));