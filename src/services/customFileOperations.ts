import { exists, mkdir, readFile, writeFile, remove } from '@tauri-apps/plugin-fs';
import { loadSettings } from './settings';

/**
 * カスタムディレクトリ用のファイル操作
 */

export async function ensureDirectory(path: string): Promise<void> {
  const dirExists = await exists(path);
  if (!dirExists) {
    await mkdir(path, { recursive: true });
  }
}

export async function writeFileAbsolute(path: string, contents: Uint8Array): Promise<void> {
  await writeFile(path, contents);
}

export async function readFileAbsolute(path: string): Promise<Uint8Array> {
  return await readFile(path);
}

export async function fileExistsAbsolute(path: string): Promise<boolean> {
  return await exists(path);
}

export async function deleteFileAbsolute(path: string): Promise<void> {
  await remove(path);
}

/**
 * 保存場所がカスタムかどうかを判定
 */
export async function isCustomSaveLocation(): Promise<boolean> {
  const settings = await loadSettings();
  return settings.saveLocation === 'custom' && !!settings.customPath;
}