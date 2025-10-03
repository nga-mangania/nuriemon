import { DatabaseService, AppSettingsService } from './database';
import { getAllMetadata } from './imageStorage';
import { fileExistsAbsolute } from './customFileOperations';
import { join } from '@tauri-apps/api/path';

/**
 * データベースをクリーンアップし、実際に存在するファイルのみを残す
 */
export async function cleanupDatabase(): Promise<void> {
  try {
    console.log('[cleanupDatabase] データベースのクリーンアップを開始します...');
    
    const metadata = await getAllMetadata();
    console.log(`[cleanupDatabase] データベース内の画像数: ${metadata.length}`);

    const hiddenEntries = metadata.filter(item => (item as any).is_hidden === 1);
    if (hiddenEntries.length > 0) {
      console.log(`[cleanupDatabase] レガシー非表示エントリを削除します: ${hiddenEntries.length}件`);
      for (const hidden of hiddenEntries) {
        try {
          await DatabaseService.deleteImage(hidden.id, 'legacy-hidden');
        } catch (error) {
          console.warn(`[cleanupDatabase] 非表示エントリ削除に失敗: ${hidden.id}`, error);
        }
      }
    }

    const activeMetadata = metadata.filter(item => (item as any).is_hidden !== 1);
    console.log('[cleanupDatabase] データベース内のファイルID一覧:', activeMetadata.map(m => ({
      id: m.id,
      fileName: m.savedFileName || (m as any).saved_file_name,
      type: (m as any).image_type || m.type,
      filePath: (m as any).file_path
    })));
    
    const currentSaveDir = await AppSettingsService.getSaveDirectory();
    console.log(`[cleanupDatabase] 現在の保存ディレクトリ: ${currentSaveDir}`);
    
    let deletedCount = 0;
    let updatedCount = 0;
    let checkedCount = 0;
    
    for (const item of activeMetadata) {
      checkedCount++;
      
      try {
        // file_pathがない場合は構築する
        let filePath = (item as any).file_path;
        
        if (!filePath) {
          // file_pathを構築
          const fileName = item.savedFileName || (item as any).saved_file_name;
          if (!fileName) {
            console.warn(`[cleanupDatabase] saved_file_nameがありません:`, item);
            continue;
          }
          
          const imageType = (item as any).image_type || item.type;
          
          if (imageType === 'bgm' || imageType === 'soundEffect') {
            filePath = await join(currentSaveDir, 'audio', fileName);
          } else if (imageType === 'background') {
            filePath = await join(currentSaveDir, 'images', 'backgrounds', fileName);
          } else {
            const subDir = item.type === 'original' ? 'originals' : 'processed';
            filePath = await join(currentSaveDir, 'images', subDir, fileName);
          }
          
          // データベースを更新
          await DatabaseService.updateImageFilePath(item.id, filePath);
          console.log(`[cleanupDatabase] file_pathを追加: ${item.id} -> ${filePath}`);
          updatedCount++;
        }
        
        // ファイルの存在確認
        const exists = await fileExistsAbsolute(filePath);
        
        if (!exists) {
          console.log(`[cleanupDatabase] ファイルが見つかりません: ${filePath}`);
          
          // 同じタイプの他のファイルを探す
          const imageType = (item as any).image_type || item.type;
          
          if (imageType === 'bgm' || imageType === 'soundEffect' || imageType === 'background') {
            
            // 実際のファイル検索は Rust 側で実装が必要なため、
            // ここでは単純に削除
            console.log(`[cleanupDatabase] エントリを削除: ${item.id}`);
            await DatabaseService.deleteImage(item.id, 'cleanup');
            deletedCount++;
          } else {
            // 通常の画像ファイル
            console.log(`[cleanupDatabase] 通常画像を削除: ${item.id}, パス: ${filePath}`);
            await DatabaseService.deleteImage(item.id, 'cleanup');
            deletedCount++;
            console.log(`[cleanupDatabase] 削除完了: ${item.id}`);
          }
        } else {
          // ファイルが存在する場合、パスが正しいか確認
          const fileName = item.savedFileName || (item as any).saved_file_name;
          const imageType = (item as any).image_type || item.type;
          let expectedPath: string;
          
          if (imageType === 'bgm' || imageType === 'soundEffect') {
            expectedPath = await join(currentSaveDir, 'audio', fileName);
          } else if (imageType === 'background') {
            expectedPath = await join(currentSaveDir, 'images', 'backgrounds', fileName);
          } else {
            const subDir = item.type === 'original' ? 'originals' : 'processed';
            expectedPath = await join(currentSaveDir, 'images', subDir, fileName);
          }
          
          if (filePath !== expectedPath) {
            console.log(`[cleanupDatabase] パスを更新: ${filePath} -> ${expectedPath}`);
            await DatabaseService.updateImageFilePath(item.id, expectedPath);
            updatedCount++;
          }
        }
      } catch (error) {
        console.error(`[cleanupDatabase] エラー (${item.id}):`, error);
      }
    }
    
    console.log(`[cleanupDatabase] 完了: ${checkedCount}件チェック, ${deletedCount}件削除, ${updatedCount}件更新`);
  } catch (error) {
    console.error('[cleanupDatabase] 致命的なエラー:', error);
    throw error;
  }
}

/**
 * 重複ファイルを検出して削除
 */
export async function removeDuplicateFiles(): Promise<void> {
  try {
    console.log('[removeDuplicateFiles] 重複ファイルの検出を開始します...');
    
    const metadata = await getAllMetadata();
    
    // タイプ別にグループ化
    const bgmFiles = metadata.filter(m => (m as any).image_type === 'bgm');
    const soundEffectFiles = metadata.filter(m => (m as any).image_type === 'soundEffect');
    const backgroundFiles = metadata.filter(m => (m as any).image_type === 'background');
    
    // 各タイプで最新のものだけを残す
    const processGroup = async (files: any[], type: string) => {
      if (files.length <= 1) return;
      
      // 作成日時でソート（新しい順）
      files.sort((a, b) => {
        const dateA = new Date(a.createdAt || a.created_at).getTime();
        const dateB = new Date(b.createdAt || b.created_at).getTime();
        return dateB - dateA;
      });
      
      console.log(`[removeDuplicateFiles] ${type}ファイル: ${files.length}件見つかりました`);
      
      // 最新のものを残して、古いものを削除
      for (let i = 1; i < files.length; i++) {
        console.log(`[removeDuplicateFiles] 古い${type}を削除: ${files[i].id}`);
        await DatabaseService.deleteImage(files[i].id, 'duplicate');
      }
    };
    
    await processGroup(bgmFiles, 'BGM');
    await processGroup(soundEffectFiles, '効果音');
    await processGroup(backgroundFiles, '背景');
    
    console.log('[removeDuplicateFiles] 重複ファイルの削除が完了しました');
  } catch (error) {
    console.error('[removeDuplicateFiles] エラー:', error);
    throw error;
  }
}
