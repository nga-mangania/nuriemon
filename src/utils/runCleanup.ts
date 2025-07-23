import { cleanupDatabase, removeDuplicateFiles } from '../services/cleanupDatabase';

/**
 * 手動でデータベースクリーンアップを実行するユーティリティ
 */
export async function runDatabaseCleanup(): Promise<void> {
  console.log('===== データベースクリーンアップ開始 =====');
  
  try {
    // Step 1: 重複ファイルを削除
    console.log('\n[Step 1] 重複ファイルの削除...');
    await removeDuplicateFiles();
    
    // Step 2: 存在しないファイルのエントリを削除
    console.log('\n[Step 2] 存在しないファイルのクリーンアップ...');
    await cleanupDatabase();
    
    console.log('\n===== クリーンアップ完了 =====');
    console.log('アプリケーションを再起動してください。');
  } catch (error) {
    console.error('\n===== クリーンアップ中にエラーが発生しました =====');
    console.error(error);
  }
}

// グローバルに公開（開発者コンソールから実行可能）
if (typeof window !== 'undefined') {
  (window as any).runDatabaseCleanup = runDatabaseCleanup;
  console.log('データベースクリーンアップユーティリティが利用可能です。');
  console.log('実行方法: window.runDatabaseCleanup()');
}