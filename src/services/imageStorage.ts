// 旧plugin-fs依存を撤廃し、ワークスペース絶対パスで統一
import { join } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { ensureDirectory, writeFileAbsolute, readFileAbsolute, fileExistsAbsolute } from './customFileOperations';
import { DatabaseService, migrateFromJSON, AppSettingsService } from './database';

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

// 旧保存先種別は廃止。常にワークスペース直下を正とする。

/**
 * 背景ファイルを保存
 */
export async function saveBackgroundFile(dataUrl: string, fileName: string): Promise<ImageMetadata> {
  const id = await DatabaseService.generateId();
  const savedFileName = `background-${id}-${fileName}`;
  const saveDir = await AppSettingsService.getSaveDirectory();
  
  // ディレクトリパスを構築
  const dirPath = await join(saveDir, 'images', 'backgrounds');
  
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
  const saveDir = await AppSettingsService.getSaveDirectory();
  
  // ディレクトリパスを構築
  const dirPath = await join(saveDir, 'audio');
  
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
    const saveDir = await AppSettingsService.getSaveDirectory();
    
    // images ディレクトリとサブディレクトリを作成（絶対パス）
    const imagesPath = await join(saveDir, IMAGES_DIR);
    if (!await fileExistsAbsolute(imagesPath)) await ensureDirectory(imagesPath);
    const originalsPath = await join(imagesPath, ORIGINALS_DIR);
    if (!await fileExistsAbsolute(originalsPath)) await ensureDirectory(originalsPath);
    const processedPath = await join(imagesPath, PROCESSED_DIR);
    if (!await fileExistsAbsolute(processedPath)) await ensureDirectory(processedPath);

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
    const metadataPath = await join(await AppSettingsService.getSaveDirectory(), METADATA_FILE);
    const jsonExists = await fileExistsAbsolute(metadataPath);

    if (!jsonExists) {
      return; // 移行する必要なし
    }

    // JSONデータを読み込み
    const data: Uint8Array = await readFileAbsolute(metadataPath);
    
    const jsonStr = new TextDecoder().decode(data);
    const metadataList = JSON.parse(jsonStr);

    if (Array.isArray(metadataList) && metadataList.length > 0) {
      console.log('既存のJSONデータをSQLiteに移行中...');
      
      // 保存場所を含めてデータを更新
      const storageLocation = await AppSettingsService.getSaveDirectory();
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

    // 保存パスを決定
    const saveDir = await AppSettingsService.getSaveDirectory();
    
    const subDir = type === 'original' ? ORIGINALS_DIR : PROCESSED_DIR;
    const imagePath = await join(saveDir, IMAGES_DIR, subDir, savedFileName);

    // 画像データをバイナリに変換して保存
    const imageBytes = base64ToUint8Array(imageData);
    
    // 保存前にディレクトリを確認・作成（絶対パス）
    const dirPath = await join(saveDir, IMAGES_DIR, subDir);
    await ensureDirectory(dirPath);
    await writeFileAbsolute(imagePath, imageBytes);

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

    console.log('[imageStorage] DatabaseService.saveImageMetadata呼び出し前:', dbMetadata.id);
    await DatabaseService.saveImageMetadata(dbMetadata);
    console.log('[imageStorage] DatabaseService.saveImageMetadata呼び出し後:', dbMetadata.id);

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
      type: (dbMeta.image_type === 'original' || dbMeta.image_type === 'processed') 
        ? dbMeta.image_type as 'original' | 'processed' 
        : 'original' as 'original' | 'processed',
      createdAt: dbMeta.created_at,
      size: dbMeta.size,
      width: dbMeta.width,
      height: dbMeta.height,
      // image_typeを追加で保持
      image_type: dbMeta.image_type,
    } as any));
  } catch (error) {
    console.error('メタデータ取得エラー:', error);
    return [];
  }
}

/**
 * 画像を読み込み
 */
export async function loadImage(metadata: ImageMetadata): Promise<string> {
  let dbMetadata: any = null;
  let imagePath: string = '';
  
  try {
    // SQLiteから最新の保存場所を取得
    const dbMetadataList = await DatabaseService.getAllImages();
    dbMetadata = dbMetadataList.find(m => m.id === metadata.id);
    
    // file_pathがある場合はそれを使用
    if ((dbMetadata as any)?.file_path) {
      imagePath = (dbMetadata as any).file_path;
    } else {
      // 互換性のため従来のパス構築も残す
      const storageLocation = dbMetadata?.storage_location || await AppSettingsService.getSaveDirectory();
      
      // nullチェック
      if (!storageLocation || !metadata.savedFileName) {
        throw new Error(`ファイルパスの構築に必要な情報が不足しています: storageLocation=${storageLocation}, savedFileName=${metadata.savedFileName}`);
      }
      
      // ファイルタイプに応じてディレクトリを決定
      let subDir: string;
      const imageType = (dbMetadata as any)?.image_type || metadata.type;
      if (imageType === 'bgm' || imageType === 'soundEffect') {
        subDir = 'audio';
      } else if (imageType === 'background') {
        subDir = 'backgrounds';
      } else {
        subDir = metadata.type === 'original' ? ORIGINALS_DIR : PROCESSED_DIR;
      }
      
      // ディレクトリパスを構築
      if (imageType === 'bgm' || imageType === 'soundEffect') {
        imagePath = await join(storageLocation, subDir, metadata.savedFileName);
      } else if (imageType === 'background') {
        imagePath = await join(storageLocation, 'images', subDir, metadata.savedFileName);
      } else {
        imagePath = await join(storageLocation, IMAGES_DIR, subDir, metadata.savedFileName);
      }
    }
    
    
    // ファイルの読み込み（絶対パス）
    const exists = await fileExistsAbsolute(imagePath);
    if (!exists) throw new Error(`ファイルが見つかりません: ${imagePath}`);
    const imageData: Uint8Array = await readFileAbsolute(imagePath);
    
    // MIMEタイプを推測
    const extension = metadata.savedFileName.split('.').pop()?.toLowerCase();
    const imageType = (dbMetadata as any)?.image_type || metadata.type;
    
    let mimeType: string;
    if (imageType === 'bgm' || imageType === 'soundEffect') {
      // 音声ファイルのMIMEタイプ
      mimeType = extension === 'mp3' ? 'audio/mp3' : 
                extension === 'mp4' ? 'audio/mp4' :
                extension === 'wav' ? 'audio/wav' : 
                'audio/mpeg';
    } else if (imageType === 'background' && (extension === 'mp4' || extension === 'mov')) {
      // 動画ファイルのMIMEタイプ
      mimeType = extension === 'mp4' ? 'video/mp4' : 'video/quicktime';
    } else {
      // 画像ファイルのMIMEタイプ
      mimeType = extension === 'png' ? 'image/png' : 
                extension === 'gif' ? 'image/gif' : 
                extension === 'webp' ? 'image/webp' : 
                'image/jpeg';
    }
    
    // Base64に変換
    const base64 = btoa(
      new Uint8Array(imageData).reduce(
        (data, byte) => data + String.fromCharCode(byte),
        ''
      )
    );
    
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.error('画像読み込みエラー:', {
      error,
      metadata,
      imagePath: imagePath || dbMetadata?.file_path || 'パス構築失敗',
      dbMetadata,
      savedFileName: metadata.savedFileName,
      originalFileName: metadata.originalFileName,
      type: metadata.type,
      imageType: (dbMetadata as any)?.image_type,
      file_path: (dbMetadata as any)?.file_path,
      storage_location: dbMetadata?.storage_location
    });
    throw error;
  }
}

/**
 * 画像を削除（ユーザー確認済み）
 */
export async function deleteImage(metadata: ImageMetadata): Promise<void> {
  try {
    // No-Deleteモードなら何もしない
    try {
      const enabled = await invoke<boolean>('get_no_delete_mode');
      if (enabled) {
        console.warn('[deleteImage] no_delete_mode=true; skip deletion for', metadata.id);
        return;
      }
    } catch {}

    // SQLiteから保存場所を取得
    const dbMetadataList = await DatabaseService.getAllImages();
    const dbMetadata = dbMetadataList.find(m => m.id === metadata.id);
    
    // file_pathがある場合はそれを使用
    let imagePath: string;
    if ((dbMetadata as any)?.file_path) {
      imagePath = (dbMetadata as any).file_path;
    } else {
      const storageLocation = dbMetadata?.storage_location || await AppSettingsService.getSaveDirectory();
      
      // nullチェック
      if (!storageLocation || !metadata.savedFileName) {
        console.warn(`ファイル削除に必要な情報が不足しています: storageLocation=${storageLocation}, savedFileName=${metadata.savedFileName}`);
        // データベースからは削除する
        await DatabaseService.deleteImage(metadata.id);
        return;
      }
      
      // ファイルタイプに応じてディレクトリを決定
      const imageType = (dbMetadata as any)?.image_type || metadata.type;
      let subDir: string;
      
      if (imageType === 'bgm' || imageType === 'soundEffect') {
        subDir = 'audio';
        imagePath = await join(storageLocation, subDir, metadata.savedFileName);
      } else if (imageType === 'background') {
        subDir = 'backgrounds';
        imagePath = await join(storageLocation, IMAGES_DIR, subDir, metadata.savedFileName);
      } else {
        subDir = metadata.type === 'original' ? ORIGINALS_DIR : PROCESSED_DIR;
        imagePath = await join(storageLocation, IMAGES_DIR, subDir, metadata.savedFileName);
      }
    }
    
    // ファイルを削除（絶対パス）
    try {
      await invoke('delete_file_absolute', { path: imagePath });
    } catch (error) {
      console.error('ファイル削除エラー:', error);
      // ファイル削除に失敗した場合はエラーを投げる
      throw new Error(`ファイルの削除に失敗しました: ${error}`);
    }

    // ファイル削除に成功した場合のみデータベースから削除
    await DatabaseService.deleteImage(metadata.id, 'user');
  } catch (error) {
    console.error('画像削除エラー:', error);
    throw error;
  }
}
