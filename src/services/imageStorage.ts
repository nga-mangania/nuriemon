import { BaseDirectory, exists, mkdir, readFile, writeFile, remove } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { loadSettings, getSaveDirectory } from './settings';
import { ensureDirectory, writeFileAbsolute, readFileAbsolute, fileExistsAbsolute } from './customFileOperations';
import { DatabaseService, ImageMetadata as DbImageMetadata, migrateFromJSON } from './database';

// 既存の型定義（後方互換性のため維持）
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

// メタデータファイル名（移行チェック用）
const METADATA_FILE = 'metadata.json';

// ディレクトリ名
const IMAGES_DIR = 'images';
const ORIGINALS_DIR = 'originals';
const PROCESSED_DIR = 'processed';

// 移行フラグ（一度だけ移行を実行）
let migrationChecked = false;

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
 * 背景ファイルを保存
 */
export async function saveBackgroundFile(dataUrl: string, fileName: string): Promise<ImageMetadata> {
  const id = await DatabaseService.generateId();
  const savedFileName = `background-${id}-${fileName}`;
  const saveDir = await getSaveDirectory();
  const baseDir = getBaseDirectory(saveDir);
  
  // ディレクトリパスを構築
  const dirPath = await join(await getSaveDirectory(), 'nuriemon', IMAGES_DIR, 'backgrounds');
  
  // ディレクトリを作成
  await ensureDirectory(dirPath);
  
  // ファイルパスを構築
  const filePath = await join(dirPath, savedFileName);
  
  // Base64データをバイナリに変換
  const base64Data = dataUrl.split(',')[1];
  const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
  
  // ファイルを保存
  await writeFileAbsolute(filePath, binaryData);
  
  // メタデータを作成
  const timestamp = await DatabaseService.getCurrentTimestamp();
  const dbMetadata: any = {
    id,
    original_file_name: fileName,
    saved_file_name: savedFileName,
    image_type: 'background',
    created_at: timestamp,
    size: binaryData.length,
    storage_location: saveDir,
    file_path: filePath
  };
  
  // データベースに保存
  await DatabaseService.saveImageMetadata(dbMetadata);
  
  // 既存の型に変換して返す
  return {
    id: dbMetadata.id,
    originalFileName: dbMetadata.original_file_name,
    savedFileName: dbMetadata.saved_file_name,
    type: 'original',
    createdAt: dbMetadata.created_at,
    size: dbMetadata.size,
    width: dbMetadata.width,
    height: dbMetadata.height
  };
}

/**
 * 音声ファイルを保存
 */
export async function saveAudioFile(dataUrl: string, fileName: string, type: 'bgm' | 'soundEffect'): Promise<ImageMetadata> {
  const id = await DatabaseService.generateId();
  const savedFileName = `${type}-${id}-${fileName}`;
  const saveDir = await getSaveDirectory();
  const baseDir = getBaseDirectory(saveDir);
  
  // ディレクトリパスを構築
  const dirPath = await join(await getSaveDirectory(), 'nuriemon', 'audio');
  
  // ディレクトリを作成
  await ensureDirectory(dirPath);
  
  // ファイルパスを構築
  const filePath = await join(dirPath, savedFileName);
  
  // Base64データをバイナリに変換
  const base64Data = dataUrl.split(',')[1];
  const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
  
  // ファイルを保存
  await writeFileAbsolute(filePath, binaryData);
  
  // メタデータを作成
  const timestamp = await DatabaseService.getCurrentTimestamp();
  const dbMetadata: any = {
    id,
    original_file_name: fileName,
    saved_file_name: savedFileName,
    image_type: type,
    created_at: timestamp,
    size: binaryData.length,
    storage_location: saveDir,
    file_path: filePath
  };
  
  // データベースに保存
  await DatabaseService.saveImageMetadata(dbMetadata);
  
  // 既存の型に変換して返す
  return {
    id: dbMetadata.id,
    originalFileName: dbMetadata.original_file_name,
    savedFileName: dbMetadata.saved_file_name,
    type: 'original',
    createdAt: dbMetadata.created_at,
    size: dbMetadata.size
  };
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

    // 既存のJSONデータをSQLiteに移行（初回のみ）
    if (!migrationChecked) {
      await checkAndMigrateData();
      migrationChecked = true;
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
 * 既存のJSONデータをSQLiteに移行
 */
async function checkAndMigrateData(): Promise<void> {
  try {
    const settings = await loadSettings();
    const metadataPath = await join(await getSaveDirectory(settings), METADATA_FILE);
    
    let jsonExists = false;
    if (settings.saveLocation === 'custom' && settings.customPath) {
      jsonExists = await fileExistsAbsolute(metadataPath);
    } else {
      const baseDir = getBaseDirectory(settings.saveLocation);
      try {
        jsonExists = await exists(metadataPath, { baseDir });
      } catch {
        jsonExists = false;
      }
    }

    if (!jsonExists) {
      return; // 移行する必要なし
    }

    // JSONデータを読み込み
    let data: Uint8Array;
    if (settings.saveLocation === 'custom' && settings.customPath) {
      data = await readFileAbsolute(metadataPath);
    } else {
      const baseDir = getBaseDirectory(settings.saveLocation);
      data = await readFile(metadataPath, { baseDir });
    }
    
    const jsonStr = new TextDecoder().decode(data);
    const metadataList = JSON.parse(jsonStr);

    if (Array.isArray(metadataList) && metadataList.length > 0) {
      console.log('既存のJSONデータをSQLiteに移行中...');
      
      // 保存場所を含めてデータを更新
      const storageLocation = await getSaveDirectory(settings);
      const updatedList = metadataList.map(item => ({
        ...item,
        storage_location: storageLocation
      }));
      
      await migrateFromJSON(updatedList);
      console.log(`${metadataList.length}件のデータを移行しました`);
      
      // 移行完了後、JSONファイルをリネーム（バックアップとして保持）
      // const backupPath = await join(await getSaveDirectory(settings), `${METADATA_FILE}.backup`);
      
      // TODO: ファイルのリネーム機能を実装
      console.log('JSONファイルはバックアップとして保持されます');
    }
  } catch (error) {
    console.error('データ移行エラー:', error);
    // 移行エラーがあっても処理を続行
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

    // 画像のサイズを取得（Canvas使用）
    let width: number | undefined;
    let height: number | undefined;
    try {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = imageData;
      });
      width = img.width;
      height = img.height;
    } catch (error) {
      console.warn('画像サイズの取得に失敗:', error);
    }

    // データベースにメタデータを保存
    const dbMetadata: any = {
      id: await DatabaseService.generateId(),
      original_file_name: originalFileName,
      saved_file_name: savedFileName,
      image_type: type,
      created_at: await DatabaseService.getCurrentTimestamp(),
      size: imageBytes.length,
      width,
      height,
      storage_location: saveDir,
      file_path: imagePath
    };

    await DatabaseService.saveImageMetadata(dbMetadata);

    // 既存の形式に変換して返す（後方互換性のため）
    const metadata: ImageMetadata = {
      id: dbMetadata.id,
      originalFileName: dbMetadata.original_file_name,
      savedFileName: dbMetadata.saved_file_name,
      type: dbMetadata.image_type as 'original' | 'processed',
      createdAt: dbMetadata.created_at,
      size: dbMetadata.size,
      width: dbMetadata.width,
      height: dbMetadata.height,
    };

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
 * すべてのメタデータを取得
 */
export async function getAllMetadata(): Promise<ImageMetadata[]> {
  try {
    const dbMetadataList = await DatabaseService.getAllImages();
    
    // 既存の形式に変換（後方互換性のため）
    return dbMetadataList.map(dbMeta => ({
      id: dbMeta.id,
      originalFileName: dbMeta.original_file_name,
      savedFileName: dbMeta.saved_file_name,
      type: dbMeta.image_type as 'original' | 'processed',
      createdAt: dbMeta.created_at,
      size: dbMeta.size,
      width: dbMeta.width,
      height: dbMeta.height,
    }));
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
    
    // SQLiteから最新の保存場所を取得
    const dbMetadataList = await DatabaseService.getAllImages();
    const dbMetadata = dbMetadataList.find(m => m.id === metadata.id);
    
    // file_pathがある場合はそれを使用
    let imagePath: string;
    if ((dbMetadata as any)?.file_path) {
      imagePath = (dbMetadata as any).file_path;
    } else {
      // 互換性のため従来のパス構築も残す
      const storageLocation = dbMetadata?.storage_location || await getSaveDirectory(settings);
      const subDir = metadata.type === 'original' ? ORIGINALS_DIR : PROCESSED_DIR;
      imagePath = await join(storageLocation, IMAGES_DIR, subDir, metadata.savedFileName);
    }
    
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
    
    // SQLiteから保存場所を取得
    const dbMetadataList = await DatabaseService.getAllImages();
    const dbMetadata = dbMetadataList.find(m => m.id === metadata.id);
    
    const storageLocation = dbMetadata?.storage_location || await getSaveDirectory(settings);
    
    // 画像ファイルを削除
    const subDir = metadata.type === 'original' ? ORIGINALS_DIR : PROCESSED_DIR;
    const imagePath = await join(storageLocation, IMAGES_DIR, subDir, metadata.savedFileName);
    
    if (settings.saveLocation === 'custom' && settings.customPath) {
      // カスタムディレクトリの場合、Rust側で削除を実装する必要がある
      // 現在はスキップ
      console.warn('カスタムディレクトリからの削除は未実装です');
    } else {
      const baseDir = getBaseDirectory(settings.saveLocation);
      await remove(imagePath, { baseDir });
    }

    // データベースから削除
    await DatabaseService.deleteImage(metadata.id);
  } catch (error) {
    console.error('画像削除エラー:', error);
    throw error;
  }
}