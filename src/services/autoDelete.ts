/**
 * 自動削除サービス
 * 設定された非表示時間に基づいて画像を自動的に削除する
 */

import { getAllMetadata, deleteImage } from './imageStorage';
import { AppSettingsService } from './database';

let autoDeleteInterval: number | null = null;

/**
 * 自動削除をチェック
 */
async function checkAutoDelete() {
  try {
    const deletionTime = await AppSettingsService.getDeletionTime();
    
    // 無制限の場合は何もしない
    if (!deletionTime || deletionTime === 'unlimited') {
      return;
    }
    
    const deletionMinutes = parseInt(deletionTime);
    if (isNaN(deletionMinutes)) {
      return;
    }
    
    // 現在時刻を取得
    const now = Date.now();
    const deletionMillis = deletionMinutes * 60 * 1000;
    
    // すべての画像を取得
    const allImages = await getAllMetadata();
    
    // 削除対象の画像を特定
    const imagesToDelete = allImages.filter(image => {
      // 処理済み画像のみを対象とする
      if (image.type !== 'processed') {
        return false;
      }
      
      // 作成時刻からの経過時間を計算
      const createdAt = new Date(image.createdAt).getTime();
      const elapsedTime = now - createdAt;
      
      return elapsedTime > deletionMillis;
    });
    
    // 画像を削除
    for (const image of imagesToDelete) {
      try {
        await deleteImage(image);
        console.log(`自動削除: ${image.originalFileName} (${deletionMinutes}分経過)`);
      } catch (error) {
        console.error(`自動削除エラー: ${image.originalFileName}`, error);
      }
    }
    
    if (imagesToDelete.length > 0) {
      console.log(`${imagesToDelete.length}個の画像を自動削除しました`);
    }
  } catch (error) {
    console.error('自動削除チェックエラー:', error);
  }
}

/**
 * 自動削除サービスを開始
 */
export function startAutoDeleteService() {
  // 既存のインターバルがあれば停止
  stopAutoDeleteService();
  
  // 初回チェック
  checkAutoDelete();
  
  // 1分ごとにチェック
  autoDeleteInterval = window.setInterval(() => {
    checkAutoDelete();
  }, 60 * 1000);
  
  console.log('自動削除サービスを開始しました');
}

/**
 * 自動削除サービスを停止
 */
export function stopAutoDeleteService() {
  if (autoDeleteInterval) {
    window.clearInterval(autoDeleteInterval);
    autoDeleteInterval = null;
    console.log('自動削除サービスを停止しました');
  }
}

/**
 * 手動で自動削除をトリガー
 */
export async function triggerAutoDelete() {
  await checkAutoDelete();
}
