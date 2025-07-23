import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { emit } from '@tauri-apps/api/event';

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

/**
 * ワークスペース管理クラス
 */
export class WorkspaceManager {
  private static instance: WorkspaceManager;
  private currentWorkspace: string | null = null;
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
    return this.currentWorkspace;
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
   * ワークスペースを切り替え
   */
  async switchWorkspace(path: string, onProgress?: (message: string) => void): Promise<void> {
    if (this.isChangingWorkspace) {
      throw new Error('ワークスペースの切り替え中です');
    }

    this.isChangingWorkspace = true;
    onProgress?.('ワークスペースを準備しています...');

    try {
      // 現在の接続をクローズ
      if (this.currentWorkspace) {
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
      await invoke('connect_workspace_db', { dbPath });

      // 現在のワークスペースを更新
      this.currentWorkspace = path;

      // グローバル設定を更新
      await this.saveLastWorkspace(path);

      // イベントを発行
      emit('workspace-changed', { path });

      onProgress?.('ワークスペースの切り替えが完了しました');
      console.log('[WorkspaceManager] ワークスペース切り替え完了:', path);

    } catch (error) {
      console.error('[WorkspaceManager] ワークスペース切り替えエラー:', error);
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
    if (!this.currentWorkspace) {
      return null;
    }

    try {
      const settingsPath = await join(this.currentWorkspace, '.nuriemon', 'settings.json');
      // Rust側でファイル読み込み（権限問題を回避）
      const bytes = await invoke<number[]>('read_file_absolute', { path: settingsPath });
      const content = new TextDecoder().decode(new Uint8Array(bytes));
      return JSON.parse(content);
    } catch (error) {
      console.error('[WorkspaceManager] ワークスペース設定読み込みエラー:', error);
      return null;
    }
  }

  /**
   * ワークスペース設定を保存
   */
  async saveWorkspaceSettings(settings: Partial<WorkspaceSettings>): Promise<void> {
    if (!this.currentWorkspace) {
      throw new Error('ワークスペースが選択されていません');
    }

    const current = await this.getWorkspaceSettings();
    if (!current) {
      throw new Error('現在の設定を読み込めませんでした');
    }

    const updated = { ...current, ...settings };
    const settingsPath = await join(this.currentWorkspace, '.nuriemon', 'settings.json');
    
    // Rust側でファイル書き込み（権限問題を回避）
    await invoke('write_file_absolute', {
      path: settingsPath,
      contents: Array.from(new TextEncoder().encode(JSON.stringify(updated, null, 2)))
    });

    // 設定変更イベントを発行
    emit('workspace-settings-changed', updated);
  }

  /**
   * 保存ディレクトリを取得（常にワークスペース内）
   */
  async getSaveDirectory(): Promise<string> {
    if (!this.currentWorkspace) {
      throw new Error('ワークスペースが選択されていません');
    }
    return this.currentWorkspace;
  }
}