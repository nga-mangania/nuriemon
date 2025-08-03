import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { emit } from '@tauri-apps/api/event';
import { useWorkspaceStore } from '../stores/workspaceStore';

// ワークスペース関連のイベントタイプ
export type WorkspaceEventType = 
  | 'workspace-changed'      // ワークスペースが変更された
  | 'workspace-data-loaded'  // ワークスペースのデータが読み込まれた
  | 'workspace-settings-updated' // ワークスペースの設定が更新された
  | 'workspace-before-change';   // ワークスペース変更前

/**
 * ワークスペース設定インターフェース
 */
export interface WorkspaceSettings {
  version: string;
  groundPosition: number;
  deletionTime: string;
  saveLocation: 'workspace'; // ワークスペース内固定
  customPath: string; // ワークスペースのパス
}

/**
 * グローバル設定インターフェース
 */
export interface GlobalSettings {
  lastWorkspace: string | null;
  windowSize?: { width: number; height: number };
}

/**
 * ワークスペース情報
 */
export interface WorkspaceInfo {
  path: string;
  isInitialized: boolean;
  settings?: WorkspaceSettings;
}

// ワークスペースイベント
export interface WorkspaceEvent {
  type: WorkspaceEventType;
  data: any;
}

/**
 * ワークスペース管理クラス
 */
export class WorkspaceManager {
  private static instance: WorkspaceManager;
  private isChangingWorkspace = false;

  private constructor() {}

  static getInstance(): WorkspaceManager {
    if (!WorkspaceManager.instance) {
      WorkspaceManager.instance = new WorkspaceManager();
    }
    return WorkspaceManager.instance;
  }

  /**
   * 現在のワークスペースパスを取得
   */
  getCurrentWorkspace(): string | null {
    return useWorkspaceStore.getState().currentWorkspace;
  }

  /**
   * ワークスペースの存在確認
   */
  async checkWorkspace(path: string): Promise<WorkspaceInfo> {
    const nuriemonPath = await join(path, '.nuriemon');
    const dbPath = await join(nuriemonPath, 'nuriemon.db');
    const settingsPath = await join(nuriemonPath, 'settings.json');

    // Rust側でファイルの存在確認（権限問題を回避）
    const hasDb = await invoke<boolean>('file_exists_absolute', { path: dbPath });
    const hasSettings = await invoke<boolean>('file_exists_absolute', { path: settingsPath });
    const isInitialized = hasDb && hasSettings;

    let settings: WorkspaceSettings | undefined;
    if (hasSettings) {
      try {
        // Rust側でファイル読み込み（権限問題を回避）
        const bytes = await invoke<number[]>('read_file_absolute', { path: settingsPath });
        const content = new TextDecoder().decode(new Uint8Array(bytes));
        settings = JSON.parse(content);
      } catch (error) {
        console.error('[WorkspaceManager] 設定ファイルの読み込みエラー:', error);
      }
    }

    return {
      path,
      isInitialized,
      settings
    };
  }

  /**
   * 新しいワークスペースを初期化
   */
  private async initializeWorkspace(path: string): Promise<void> {
    console.log('[WorkspaceManager] 新しいワークスペースを初期化:', path);

    const nuriemonPath = await join(path, '.nuriemon');
    console.log('[WorkspaceManager] .nuriemonフォルダパス:', nuriemonPath);

    try {
      // Rust側でフォルダとDBを初期化（ファイルシステムの権限問題を回避）
      const dbPath = await join(nuriemonPath, 'nuriemon.db');
      console.log('[WorkspaceManager] DBパス:', dbPath);
      await invoke('initialize_workspace_db', { dbPath });

      console.log('[WorkspaceManager] DB初期化完了');
    } catch (error) {
      console.error('[WorkspaceManager] DB初期化エラー:', error);
      throw new Error('ワークスペースの初期化に失敗しました: ' + (error instanceof Error ? error.message : String(error)));
    }

    try {
      // デフォルト設定を作成
      const defaultSettings: WorkspaceSettings = {
        version: '1.0.0',
        groundPosition: 80,
        deletionTime: 'unlimited',
        saveLocation: 'workspace',
        customPath: path
      };

      const settingsPath = await join(nuriemonPath, 'settings.json');
      console.log('[WorkspaceManager] 設定ファイルパス:', settingsPath);
      
      // Rust側でファイル書き込み（権限問題を回避）
      await invoke('write_file_absolute', {
        path: settingsPath,
        contents: Array.from(new TextEncoder().encode(JSON.stringify(defaultSettings, null, 2)))
      });
      
      console.log('[WorkspaceManager] 設定ファイル作成完了');
    } catch (error) {
      console.error('[WorkspaceManager] 設定ファイル作成エラー:', error);
      throw new Error('設定ファイルの作成に失敗しました: ' + (error instanceof Error ? error.message : String(error)));
    }

    console.log('[WorkspaceManager] ワークスペース初期化完了');
  }

  /**
   * ワークスペースイベントを発行
   */
  private emitWorkspaceEvent(event: WorkspaceEvent) {
    console.log(`[WorkspaceManager] Emitting ${event.type}`, event.data);
    emit(event.type, event.data);
    
    // デバッグ用に全てのイベントタイプを同時に発火することも確認
    console.log('[WorkspaceManager] イベント発火詳細:', {
      type: event.type,
      data: event.data,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * ワークスペースを切り替え
   */
  async switchWorkspace(path: string, onProgress?: (message: string) => void): Promise<void> {
    if (this.isChangingWorkspace) {
      throw new Error('ワークスペースの切り替え中です');
    }

    console.log('[WorkspaceManager] ⭐ Switching workspace to:', path);
    this.isChangingWorkspace = true;
    onProgress?.('ワークスペースを準備しています...');

    try {
      // 現在の接続をクローズ
      const currentWorkspace = this.getCurrentWorkspace();
      if (currentWorkspace) {
        // ワークスペース変更前イベントを発行
        this.emitWorkspaceEvent({
          type: 'workspace-before-change',
          data: { 
            oldPath: currentWorkspace, 
            newPath: path 
          }
        });
        
        onProgress?.('現在のワークスペースを閉じています...');
        await invoke('close_workspace_db');
      }

      // ワークスペースの状態を確認
      const info = await this.checkWorkspace(path);

      if (!info.isInitialized) {
        onProgress?.('新しいワークスペースを初期化しています...');
        await this.initializeWorkspace(path);
      }

      // 新しいDBに接続
      onProgress?.('データベースに接続しています...');
      const nuriemonPath = await join(path, '.nuriemon');
      const dbPath = await join(nuriemonPath, 'nuriemon.db');
      console.log('[WorkspaceManager] 📡 Rust側にDB接続を要求...');
      await invoke('connect_workspace_db', { dbPath });
      console.log('[WorkspaceManager] ✅ Rust側DB接続完了');

      // Zustandストアを更新
      const oldWorkspace = useWorkspaceStore.getState().currentWorkspace;
      
      // ワークスペース設定を読み込む
      const workspaceInfo = await this.checkWorkspace(path);
      if (workspaceInfo.settings) {
        useWorkspaceStore.getState().setSettings(workspaceInfo.settings);
      }
      useWorkspaceStore.getState().setCurrentWorkspace(path);
      
      console.log('[WorkspaceManager] ✅ ワークスペース変更完了:', oldWorkspace, '->', path);

      // グローバル設定を更新
      await this.saveLastWorkspace(path);

      // ワークスペース変更イベントを発行
      this.emitWorkspaceEvent({
        type: 'workspace-changed',
        data: { path, dbPath }
      });

      // データ読み込み完了イベントを発行（少し遅延させて、DBが確実に準備できるようにする）
      setTimeout(() => {
        console.log('[WorkspaceManager] 🔔 workspace-data-loadedイベントを発火します');
        this.emitWorkspaceEvent({
          type: 'workspace-data-loaded',
          data: { path }
        });
        console.log('[WorkspaceManager] ✅ workspace-data-loadedイベント発火完了');
      }, 100);

      onProgress?.('ワークスペースの切り替えが完了しました');
      console.log('[WorkspaceManager] ワークスペース切り替え完了:', path);

    } catch (error) {
      console.error('[WorkspaceManager] ❌ ワークスペース切り替えエラー:', error);
      throw error;
    } finally {
      this.isChangingWorkspace = false;
    }
  }

  /**
   * 最後に使用したワークスペースを保存
   */
  private async saveLastWorkspace(path: string): Promise<void> {
    await invoke('save_global_setting', { 
      key: 'lastWorkspace', 
      value: path 
    });
  }

  /**
   * 最後に使用したワークスペースを取得
   */
  async getLastWorkspace(): Promise<string | null> {
    try {
      const value = await invoke<string | null>('get_global_setting', { 
        key: 'lastWorkspace' 
      });
      return value;
    } catch (error) {
      console.error('[WorkspaceManager] 最後のワークスペース取得エラー:', error);
      return null;
    }
  }

  /**
   * ワークスペース設定を取得
   */
  async getWorkspaceSettings(): Promise<WorkspaceSettings | null> {
    // まずストアから取得を試みる
    const state = useWorkspaceStore.getState();
    if (state.settings) {
      return state.settings;
    }
    
    // ストアにない場合はファイルから読み込む
    const currentWorkspace = state.currentWorkspace;
    if (!currentWorkspace) {
      return null;
    }

    try {
      const settingsPath = await join(currentWorkspace, '.nuriemon', 'settings.json');
      // Rust側でファイル読み込み（権限問題を回避）
      const bytes = await invoke<number[]>('read_file_absolute', { path: settingsPath });
      let content = new TextDecoder().decode(new Uint8Array(bytes));
      
      // JSONの破損を修復
      // 末尾の不正な文字列を削除
      const lastBraceIndex = content.lastIndexOf('}');
      if (lastBraceIndex !== -1) {
        const afterLastBrace = content.substring(lastBraceIndex + 1).trim();
        if (afterLastBrace && !afterLastBrace.match(/^\s*$/)) {
          console.warn('[WorkspaceManager] JSONの末尾に不正な文字列を検出:', afterLastBrace);
          content = content.substring(0, lastBraceIndex + 1);
        }
      }
      
      // デバッグログ追加
      console.log('[WorkspaceManager] settings.json content length:', content.length);
      if (content.length > 1000) {
        console.log('[WorkspaceManager] settings.json preview:', content.substring(0, 200) + '...');
      } else {
        console.log('[WorkspaceManager] settings.json content:', content);
      }
      
      try {
        return JSON.parse(content);
      } catch (parseError) {
        console.error('[WorkspaceManager] JSON解析エラー詳細:', parseError);
        console.error('[WorkspaceManager] 問題のあるJSON:', content);
        throw parseError;
      }
    } catch (error) {
      console.error('[WorkspaceManager] ワークスペース設定読み込みエラー:', error);
      return null;
    }
  }

  /**
   * ワークスペース設定を保存
   */
  async saveWorkspaceSettings(settings: Partial<WorkspaceSettings>): Promise<void> {
    const currentWorkspace = useWorkspaceStore.getState().currentWorkspace;
    
    if (!currentWorkspace) {
      throw new Error('ワークスペースが選択されていません');
    }

    let current = await this.getWorkspaceSettings();
    if (!current) {
      // 初期設定を作成
      console.log('[WorkspaceManager] 現在の設定が読み込めないため、初期設定を作成します');
      current = {
        version: '1.0.0',
        groundPosition: 50,
        deletionTime: 'unlimited',
        saveLocation: 'workspace',
        customPath: currentWorkspace
      };
    }

    const updated = { ...current, ...settings };
    const settingsPath = await join(currentWorkspace, '.nuriemon', 'settings.json');
    
    // 保存前のデバッグログ
    console.log('[WorkspaceManager] 保存する設定:', updated);
    const jsonString = JSON.stringify(updated, null, 2);
    console.log('[WorkspaceManager] JSON文字列長:', jsonString.length);
    
    // Rust側でファイル書き込み（権限問題を回避）
    await invoke('write_file_absolute', {
      path: settingsPath,
      contents: Array.from(new TextEncoder().encode(jsonString))
    });

    // Zustandストアを更新
    console.log('[WorkspaceManager] Zustandストアを更新します:', settings);
    useWorkspaceStore.getState().updateSettings(settings);
    console.log('[WorkspaceManager] ストア更新後の地面位置:', useWorkspaceStore.getState().groundPosition);
    
    // 設定変更イベントを発行
    this.emitWorkspaceEvent({
      type: 'workspace-settings-updated',
      data: updated
    });

    // data-changedイベントは削除し、Zustandストアの更新のみ行う
    // AnimationViewなどのコンポーネントはZustandから直接状態を購読する
  }

  /**
   * 保存ディレクトリを取得（常にワークスペース内）
   */
  async getSaveDirectory(): Promise<string> {
    const currentWorkspace = useWorkspaceStore.getState().currentWorkspace;
    if (!currentWorkspace) {
      throw new Error('ワークスペースが選択されていません');
    }
    return currentWorkspace;
  }
}