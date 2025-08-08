import { load } from '@tauri-apps/plugin-store';

// Storeインスタンスを保持
let store: any = null;

// ストアの初期化
export async function initializeStore() {
  if (!store) {
    store = await load('nuriemon-settings.dat');
  }
}

// 画像リストを保存
export async function saveImageList(images: any[]) {
  await initializeStore();
  await store.set('imageList', images);
  await store.save();
}

// 画像リストを取得
export async function getImageList(): Promise<any[]> {
  await initializeStore();
  const images = await store.get('imageList') as any[];
  return images || [];
}

// 現在のワークスペースを保存
export async function saveCurrentWorkspace(workspace: any) {
  await initializeStore();
  await store.set('currentWorkspace', workspace);
  await store.save();
}

// 現在のワークスペースを取得
export async function getCurrentWorkspace() {
  await initializeStore();
  return await store.get('currentWorkspace');
}

// すべての設定を取得
export async function getAllSettings() {
  await initializeStore();
  return await store.entries();
}