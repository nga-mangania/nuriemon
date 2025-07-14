import { BaseDirectory, exists, mkdir, readFile, writeFile, remove } from '@tauri-apps/plugin-fs';
import { join, appDataDir } from '@tauri-apps/api/path';

// 画像のメタデータ型
export interface ImageMetadata {
  id: string;
  originalFileName: string;
  savedFileName: string;
  type: 'original' | 'processed';
  createdAt: string;
  size: number;
  width?: number;
  height?: number;
}

// メタデータファイル名
const METADATA_FILE = 'metadata.json';

// ディレクトリ名
const IMAGES_DIR = 'images';
const ORIGINALS_DIR = 'originals';
const PROCESSED_DIR = 'processed';

/**
 * アプリケーションのデータディレクトリを初期化
 */
export async function initializeStorage(): Promise<void> {
  try {
    // imagesディレクトリが存在しない場合は作成
    const imagesPath = await join(await appDataDir(), IMAGES_DIR);
    if (!await exists(imagesPath)) {
      await mkdir(imagesPath, { recursive: true });
    }

    // サブディレクトリを作成
    const originalsPath = await join(imagesPath, ORIGINALS_DIR);
    const processedPath = await join(imagesPath, PROCESSED_DIR);
    
    if (!await exists(originalsPath)) {
      await mkdir(originalsPath, { recursive: true });
    }
    
    if (!await exists(processedPath)) {
      await mkdir(processedPath, { recursive: true });
    }

    // メタデータファイルが存在しない場合は初期化
    const metadataPath = await join(await appDataDir(), METADATA_FILE);
    if (!await exists(metadataPath)) {
      await writeFile(metadataPath, new TextEncoder().encode('[]'));
    }
  } catch (error) {
    console.error('ストレージ初期化エラー:', error);
    throw error;
  }
}

/**
 * 画像をBase64からバイナリに変換
 */
function base64ToUint8Array(base64: string): Uint8Array {
  // data:image/png;base64, の部分を削除
  const base64Data = base64.split(',')[1];
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  return bytes;
}

/**
 * 画像を保存
 */
export async function saveImage(
  imageData: string,
  originalFileName: string,
  type: 'original' | 'processed' = 'original'
): Promise<ImageMetadata> {
  try {
    await initializeStorage();

    // ユニークなファイル名を生成
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const extension = originalFileName.split('.').pop() || 'png';
    const savedFileName = `${timestamp}-${Math.random().toString(36).substr(2, 9)}.${extension}`;

    // 保存パスを決定
    const subDir = type === 'original' ? ORIGINALS_DIR : PROCESSED_DIR;
    const imagePath = await join(await appDataDir(), IMAGES_DIR, subDir, savedFileName);

    // 画像データをバイナリに変換して保存
    const imageBytes = base64ToUint8Array(imageData);
    await writeFile(imagePath, imageBytes);

    // メタデータを作成
    const metadata: ImageMetadata = {
      id: `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      originalFileName,
      savedFileName,
      type,
      createdAt: new Date().toISOString(),
      size: imageBytes.length,
    };

    // 画像のサイズを取得（Canvas使用）
    try {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = imageData;
      });
      metadata.width = img.width;
      metadata.height = img.height;
    } catch (error) {
      console.warn('画像サイズの取得に失敗:', error);
    }

    // メタデータを保存
    await saveMetadata(metadata);

    return metadata;
  } catch (error) {
    console.error('画像保存エラー:', error);
    throw error;
  }
}

/**
 * メタデータを保存
 */
async function saveMetadata(newMetadata: ImageMetadata): Promise<void> {
  const metadataPath = await join(await appDataDir(), METADATA_FILE);
  
  // 既存のメタデータを読み込み
  let metadataList: ImageMetadata[] = [];
  try {
    const data = await readFile(metadataPath);
    const jsonStr = new TextDecoder().decode(data);
    metadataList = JSON.parse(jsonStr);
  } catch (error) {
    console.warn('メタデータ読み込みエラー:', error);
  }

  // 新しいメタデータを追加
  metadataList.push(newMetadata);

  // 保存
  const jsonData = JSON.stringify(metadataList, null, 2);
  await writeFile(metadataPath, new TextEncoder().encode(jsonData));
}

/**
 * すべてのメタデータを取得
 */
export async function getAllMetadata(): Promise<ImageMetadata[]> {
  try {
    const metadataPath = await join(await appDataDir(), METADATA_FILE);
    const data = await readFile(metadataPath);
    const jsonStr = new TextDecoder().decode(data);
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error('メタデータ取得エラー:', error);
    return [];
  }
}

/**
 * 画像を読み込み
 */
export async function loadImage(metadata: ImageMetadata): Promise<string> {
  try {
    const subDir = metadata.type === 'original' ? ORIGINALS_DIR : PROCESSED_DIR;
    const imagePath = await join(await appDataDir(), IMAGES_DIR, subDir, metadata.savedFileName);
    
    const imageData = await readFile(imagePath);
    
    // MIMEタイプを推測
    const extension = metadata.savedFileName.split('.').pop()?.toLowerCase();
    const mimeType = extension === 'png' ? 'image/png' : 
                    extension === 'gif' ? 'image/gif' : 
                    extension === 'webp' ? 'image/webp' : 
                    'image/jpeg';
    
    // Base64に変換
    const base64 = btoa(
      new Uint8Array(imageData).reduce(
        (data, byte) => data + String.fromCharCode(byte),
        ''
      )
    );
    
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.error('画像読み込みエラー:', error);
    throw error;
  }
}

/**
 * 画像を削除
 */
export async function deleteImage(metadata: ImageMetadata): Promise<void> {
  try {
    // 画像ファイルを削除
    const subDir = metadata.type === 'original' ? ORIGINALS_DIR : PROCESSED_DIR;
    const imagePath = await join(await appDataDir(), IMAGES_DIR, subDir, metadata.savedFileName);
    await remove(imagePath);

    // メタデータから削除
    const metadataPath = await join(await appDataDir(), METADATA_FILE);
    const allMetadata = await getAllMetadata();
    const updatedMetadata = allMetadata.filter(m => m.id !== metadata.id);
    
    const jsonData = JSON.stringify(updatedMetadata, null, 2);
    await writeFile(metadataPath, new TextEncoder().encode(jsonData));
  } catch (error) {
    console.error('画像削除エラー:', error);
    throw error;
  }
}