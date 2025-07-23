import { DatabaseService, AppSettingsService } from './database';
import { getAllMetadata } from './imageStorage';
import { join } from '@tauri-apps/api/path';

const IMAGES_DIR = 'images';
const ORIGINALS_DIR = 'originals';
const PROCESSED_DIR = 'processed';

/**
 * 既存データのfile_pathを更新するマイグレーション
 */
export async function migrateFilePaths(): Promise<void> {
  try {
    console.log('Starting file path migration...');
    
    const metadata = await getAllMetadata();
    let updatedCount = 0;
    let skippedCount = 0;
    
    for (const item of metadata) {
      // すでにfile_pathがある場合はスキップ
      if ((item as any).file_path) {
        skippedCount++;
        continue;
      }
      
      try {
        // file_pathを構築
        const storageLocation = (item as any).storage_location || await AppSettingsService.getSaveDirectory();
        const imageType = (item as any).image_type || item.type;
        let filePath: string;
        
        const fileName = item.savedFileName || (item as any).saved_file_name;
        if (!fileName) {
          console.warn(`No saved file name for ${item.originalFileName || (item as any).original_file_name}, skipping...`);
          continue;
        }
        
        if (imageType === 'bgm' || imageType === 'soundEffect') {
          filePath = await join(storageLocation, 'audio', fileName);
        } else if (imageType === 'background') {
          filePath = await join(storageLocation, 'images', 'backgrounds', fileName);
        } else {
          const subDir = item.type === 'original' ? ORIGINALS_DIR : PROCESSED_DIR;
          filePath = await join(storageLocation, IMAGES_DIR, subDir, fileName);
        }
        
        // データベースを更新 - file_pathのみを更新
        await DatabaseService.updateImageFilePath(item.id, filePath);
        updatedCount++;
        console.log(`Updated file_path for ${item.originalFileName || (item as any).original_file_name}`);
        
      } catch (error) {
        console.error(`Failed to update file_path for ${item.originalFileName || (item as any).original_file_name}:`, error);
      }
    }
    
    console.log(`Migration completed: ${updatedCount} updated, ${skippedCount} skipped`);
  } catch (error) {
    console.error('File path migration error:', error);
    throw error;
  }
}