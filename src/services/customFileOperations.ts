import { invoke } from '@tauri-apps/api/core';
import { loadSettings } from './settings';

/**
 * カスタムディレクトリ用のファイル操作
 */

export async function ensureDirectory(path: string): Promise<void> {
  await invoke('ensure_directory', { path });
}

export async function writeFileAbsolute(path: string, contents: Uint8Array): Promise<void> {
  await invoke('write_file_absolute', { 
    path, 
    contents: Array.from(contents) 
  });
}

export async function readFileAbsolute(path: string): Promise<Uint8Array> {
  const result = await invoke<number[]>('read_file_absolute', { path });
  return new Uint8Array(result);
}

export async function fileExistsAbsolute(path: string): Promise<boolean> {
  return await invoke<boolean>('file_exists_absolute', { path });
}

/**
 * 保存場所がカスタムかどうかを判定
 */
export async function isCustomSaveLocation(): Promise<boolean> {
  const settings = await loadSettings();
  return settings.saveLocation === 'custom' && !!settings.customPath;
}