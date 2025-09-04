// Simple auto-updater helper for Tauri v2 plugin-updater
export async function autoCheckForUpdates() {
  try {
    const mod = await import('@tauri-apps/plugin-updater');
    const { check } = mod as any;
    const update = await check();
    if (update && update.available) {
      const ok = confirm(`新しいバージョンが見つかりました\n${update.currentVersion} → ${update.version}\n更新を開始しますか？`);
      if (ok) {
        await update.downloadAndInstall();
        // アプリは自動再起動される
      }
    }
  } catch (e) {
    // ネットワーク未接続など、静かにスキップ
    console.warn('[updater] check failed', e);
  }
}

