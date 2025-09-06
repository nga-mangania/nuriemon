import { message, confirm } from '@tauri-apps/plugin-dialog';

async function loadUpdater(): Promise<null | { check: () => Promise<any> }>{
  try {
    // 遅延ロード（バンドラに解決させないための回避策）
    const dynamicImport: any = (new Function('m', 'return import(m)'));
    const mod = await dynamicImport('@tauri-apps/plugin-updater');
    return mod as any;
  } catch {
    return null;
  }
}

export async function checkForUpdatesOnStartup() {
  try {
    const up = await loadUpdater();
    if (!up || typeof up.check !== 'function') return; // 環境未整備なら無視
    const update = await up.check();
    if (update?.available) {
      const ok = await confirm(`新しいバージョン ${update.version} が利用可能です。今すぐ更新しますか？`, { title: 'アップデート', kind: 'info' });
      if (ok) {
        await update.downloadAndInstall?.();
        await message('更新が完了しました。アプリを再起動します。', { title: 'アップデート完了' });
        // 再起動は OS によって異なるため、明示に終了するのみ
        // (Tauri v2 では updater 側の再起動 API 追加を検討)
      }
    }
  } catch (_) {
    // ネットワーク不通や未設定の環境では無視
  }
}

export async function checkForUpdatesManually() {
  try {
    const up = await loadUpdater();
    if (!up || typeof up.check !== 'function') {
      await message('アップデータが無効です。依存関係が未導入の可能性があります。', { title: 'アップデート', kind: 'warning' });
      return;
    }
    const update = await up.check();
    if (update?.available) {
      const ok = await confirm(`新しいバージョン ${update.version} が利用可能です。更新しますか？`, { title: 'アップデート', kind: 'info' });
      if (ok) {
        await update.downloadAndInstall?.();
        await message('更新が完了しました。アプリを再起動します。', { title: 'アップデート完了' });
      }
    } else {
      await message('最新の状態です。', { title: 'アップデート' });
    }
  } catch (e) {
    await message('アップデートの確認に失敗しました。', { title: 'アップデート', kind: 'error' });
  }
}
