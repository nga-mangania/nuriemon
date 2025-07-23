import { DatabaseService, AppSettingsService } from './database';
import { getAllMetadata } from './imageStorage';
import { join } from '@tauri-apps/api/path';

/**
 * 現在の設定に基づいて全ファイルのパスを更新
 */
export async function updateAllFilePaths(): Promise<void> {
  try {
    console.log('[updateFilePaths] ファイルパスの更新を開始します...');
    
    // 現在の保存ディレクトリを取得
    const currentSaveDir = await AppSettingsService.getSaveDirectory();
    console.log('[updateFilePaths] 現在の保存ディレクトリ:', currentSaveDir);
    
    // 全メタデータを取得
    const metadata = await getAllMetadata();
    console.log('[updateFilePaths] メタデータ数:', metadata.length);
    
    let updatedCount = 0;
    let errorCount = 0;
    
    for (const item of metadata) {
      try {
        const fileName = item.savedFileName || (item as any).saved_file_name;
        if (!fileName) {
          console.warn(`[updateFilePaths] ファイル名がありません:`, item);
          errorCount++;
          continue;
        }
        
        const imageType = (item as any).image_type || item.type;
        let newFilePath: string;
        
        // 新しいファイルパスを構築
        if (imageType === 'bgm' || imageType === 'soundEffect') {
          newFilePath = await join(currentSaveDir, 'nuriemon', 'audio', fileName);
        } else if (imageType === 'background') {
          newFilePath = await join(currentSaveDir, 'nuriemon', 'images', 'backgrounds', fileName);
        } else {
          const subDir = item.type === 'original' ? 'originals' : 'processed';
          newFilePath = await join(currentSaveDir, 'nuriemon', 'images', subDir, fileName);
        }
        
        // データベースを更新
        await DatabaseService.updateImageFilePath(item.id, newFilePath);
        updatedCount++;
        
        console.log(`[updateFilePaths] 更新: ${fileName} -> ${newFilePath}`);
      } catch (error) {
        console.error(`[updateFilePaths] エラー:`, item, error);
        errorCount++;
      }
    }
    
    console.log(`[updateFilePaths] 完了: ${updatedCount}件更新, ${errorCount}件エラー`);
  } catch (error) {
    console.error('[updateFilePaths] 致命的なエラー:', error);
    throw error;
  }
}