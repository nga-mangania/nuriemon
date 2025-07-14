import { BaseDirectory, exists, mkdir, readFile, writeFile, remove } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { loadSettings, getSaveDirectory } from './settings';
import { ensureDirectory, writeFileAbsolute, readFileAbsolute, fileExistsAbsolute } from './customFileOperations';

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
 * 保存場所に対応するベースディレクトリを取得
 */
function getBaseDirectory(saveLocation: string): BaseDirectory {
  switch (saveLocation) {
    case 'pictures':
      return BaseDirectory.Picture;
    case 'downloads':
      return BaseDirectory.Download;
    case 'documents':
      return BaseDirectory.Document;
    case 'appData':
    default:
      return BaseDirectory.AppData;
  }
}

/**
 * アプリケーションのデータディレクトリを初期化
 */
export async function initializeStorage(): Promise<void> {
  try {
    const settings = await loadSettings();
    const saveDir = await getSaveDirectory(settings);
    
    // imagesディレクトリが存在しない場合は作成
    const imagesPath = await join(saveDir, IMAGES_DIR);
    
    try {
      // カスタムディレクトリの場合は特別な処理
      if (settings.saveLocation === 'custom' && settings.customPath) {
        // カスタムパスの場合は絶対パスとして扱う
        if (!await fileExistsAbsolute(imagesPath)) {
          await ensureDirectory(imagesPath);
        }
      } else {
        // 標準ディレクトリの場合
        const baseDir = getBaseDirectory(settings.saveLocation);
        if (!await exists(imagesPath, { baseDir })) {
          await mkdir(imagesPath, { baseDir, recursive: true });
        }
      }
    } catch (error) {
      // カスタムディレクトリの場合は、ベースディレクトリを使わない絶対パス操作を試行
      try {
        await mkdir(imagesPath, { recursive: true });
      } catch (mkdirError) {
        console.error('initializeStorage: ディレクトリ作成失敗', mkdirError);
        throw mkdirError;
      }
    }

    // サブディレクトリを作成
    const originalsPath = await join(imagesPath, ORIGINALS_DIR);
    const processedPath = await join(imagesPath, PROCESSED_DIR);
    
    if (settings.saveLocation === 'custom' && settings.customPath) {
      // カスタムディレクトリの場合
      if (!await fileExistsAbsolute(originalsPath)) {
        await ensureDirectory(originalsPath);
      }
      if (!await fileExistsAbsolute(processedPath)) {
        await ensureDirectory(processedPath);
      }
    } else {
      // 標準ディレクトリの場合
      const baseDir = getBaseDirectory(settings.saveLocation);
      try {
        if (!await exists(originalsPath, { baseDir })) {
          await mkdir(originalsPath, { baseDir, recursive: true });
        }
      } catch (error) {
        await mkdir(originalsPath, { baseDir, recursive: true });
      }
      
      try {
        if (!await exists(processedPath, { baseDir })) {
          await mkdir(processedPath, { baseDir, recursive: true });
        }
      } catch (error) {
        await mkdir(processedPath, { baseDir, recursive: true });
      }
    }

    // メタデータファイルが存在しない場合は初期化
    const metadataPath = await join(saveDir, METADATA_FILE);
    try {
      if (settings.saveLocation === 'custom' && settings.customPath) {
        // カスタムパスの場合
        if (!await fileExistsAbsolute(metadataPath)) {
          await writeFileAbsolute(metadataPath, new TextEncoder().encode('[]'));
        }
      } else {
        // 標準ディレクトリの場合
        const baseDir = getBaseDirectory(settings.saveLocation);
        if (!await exists(metadataPath, { baseDir })) {
          await writeFile(metadataPath, new TextEncoder().encode('[]'), { baseDir });
        }
      }
    } catch (error) {
      await writeFile(metadataPath, new TextEncoder().encode('[]'));
    }
  } catch (error) {
    console.error('ストレージ初期化エラー:', error);
    console.error('エラー詳細:', {
      message: error instanceof Error ? error.message : '不明なエラー',
      stack: error instanceof Error ? error.stack : undefined
    });
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

    // 設定を読み込み
    const settings = await loadSettings();
    
    // 保存パスを決定
    const saveDir = await getSaveDirectory(settings);
    
    const subDir = type === 'original' ? ORIGINALS_DIR : PROCESSED_DIR;
    const imagePath = await join(saveDir, IMAGES_DIR, subDir, savedFileName);

    // 画像データをバイナリに変換して保存
    const imageBytes = base64ToUint8Array(imageData);
    
    // カスタムディレクトリの場合は特別な処理
    if (settings.saveLocation === 'custom' && settings.customPath) {
      await writeFileAbsolute(imagePath, imageBytes);
    } else {
      const baseDir = getBaseDirectory(settings.saveLocation);
      await writeFile(imagePath, imageBytes, { baseDir });
    }

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
    console.error('エラー詳細:', {
      message: error instanceof Error ? error.message : '不明なエラー',
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}

/**
 * メタデータを保存
 */
async function saveMetadata(newMetadata: ImageMetadata): Promise<void> {
  const settings = await loadSettings();
  const metadataPath = await join(await getSaveDirectory(settings), METADATA_FILE);
  
  // 既存のメタデータを読み込み
  let metadataList: ImageMetadata[] = [];
  try {
    if (settings.saveLocation === 'custom' && settings.customPath) {
      if (await fileExistsAbsolute(metadataPath)) {
        const data = await readFileAbsolute(metadataPath);
        const jsonStr = new TextDecoder().decode(data);
        metadataList = JSON.parse(jsonStr);
      }
    } else {
      const baseDir = getBaseDirectory(settings.saveLocation);
      const data = await readFile(metadataPath, { baseDir });
      const jsonStr = new TextDecoder().decode(data);
      metadataList = JSON.parse(jsonStr);
    }
  } catch (error) {
    console.warn('メタデータ読み込みエラー:', error);
  }

  // 新しいメタデータを追加
  metadataList.push(newMetadata);

  // 保存
  const jsonData = JSON.stringify(metadataList, null, 2);
  if (settings.saveLocation === 'custom' && settings.customPath) {
    await writeFileAbsolute(metadataPath, new TextEncoder().encode(jsonData));
  } else {
    const baseDir = getBaseDirectory(settings.saveLocation);
    await writeFile(metadataPath, new TextEncoder().encode(jsonData), { baseDir });
  }
}

/**
 * すべてのメタデータを取得
 */
export async function getAllMetadata(): Promise<ImageMetadata[]> {
  try {
    const settings = await loadSettings();
    const metadataPath = await join(await getSaveDirectory(settings), METADATA_FILE);
    
    let data: Uint8Array;
    if (settings.saveLocation === 'custom' && settings.customPath) {
      if (await fileExistsAbsolute(metadataPath)) {
        data = await readFileAbsolute(metadataPath);
      } else {
        return [];
      }
    } else {
      const baseDir = getBaseDirectory(settings.saveLocation);
      data = await readFile(metadataPath, { baseDir });
    }
    
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
    const settings = await loadSettings();
    const subDir = metadata.type === 'original' ? ORIGINALS_DIR : PROCESSED_DIR;
    const imagePath = await join(await getSaveDirectory(settings), IMAGES_DIR, subDir, metadata.savedFileName);
    
    let imageData: Uint8Array;
    if (settings.saveLocation === 'custom' && settings.customPath) {
      imageData = await readFileAbsolute(imagePath);
    } else {
      const baseDir = getBaseDirectory(settings.saveLocation);
      imageData = await readFile(imagePath, { baseDir });
    }
    
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
    const settings = await loadSettings();
    
    // 画像ファイルを削除
    const subDir = metadata.type === 'original' ? ORIGINALS_DIR : PROCESSED_DIR;
    const imagePath = await join(await getSaveDirectory(settings), IMAGES_DIR, subDir, metadata.savedFileName);
    
    if (settings.saveLocation === 'custom' && settings.customPath) {
      // カスタムディレクトリの場合、Rust側で削除を実装する必要がある
      // 現在はスキップ
      console.warn('カスタムディレクトリからの削除は未実装です');
    } else {
      const baseDir = getBaseDirectory(settings.saveLocation);
      await remove(imagePath, { baseDir });
    }

    // メタデータから削除
    const metadataPath = await join(await getSaveDirectory(settings), METADATA_FILE);
    const allMetadata = await getAllMetadata();
    const updatedMetadata = allMetadata.filter(m => m.id !== metadata.id);
    
    const jsonData = JSON.stringify(updatedMetadata, null, 2);
    if (settings.saveLocation === 'custom' && settings.customPath) {
      await writeFileAbsolute(metadataPath, new TextEncoder().encode(jsonData));
    } else {
      const baseDir = getBaseDirectory(settings.saveLocation);
      await writeFile(metadataPath, new TextEncoder().encode(jsonData), { baseDir });
    }
  } catch (error) {
    console.error('画像削除エラー:', error);
    throw error;
  }
}