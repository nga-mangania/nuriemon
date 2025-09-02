import { invoke } from '@tauri-apps/api/core';
import { WorkspaceManager } from './workspaceManager';
import { GlobalSettingsService } from './globalSettings';

// 旧 app_settings（DB）/settings.json 由来の設定を
// ワークスペース settings.json + GlobalSettings に移行する
export async function migrateLegacySettingsToWorkspace(): Promise<void> {
  try {
    const manager = WorkspaceManager.getInstance();
    const ws = manager.getCurrentWorkspace();
    if (!ws) return; // ワークスペース未選択なら何もしない

    // DBのapp_settingsから必要なキーをまとめて取得
    const keys = [
      'operation_mode',
      'relay_event_id',
      'pcid',
      'auto_import_path',
      'auto_import_enabled',
      // 互換キー
      'pc_id',
    ];
    let map: Record<string, string> = {};
    try {
      map = await invoke('get_app_settings', { keys });
    } catch (_) {
      // 旧APIが存在しない場合はスキップ
      return;
    }

    const partial: any = {};
    if (map['operation_mode']) partial.operation_mode = map['operation_mode'];
    if (map['auto_import_path']) partial.auto_import_path = map['auto_import_path'];
    if (map['auto_import_enabled']) partial.auto_import_enabled = map['auto_import_enabled'];

    if (Object.keys(partial).length > 0) {
      await manager.saveWorkspaceSettings(partial);
      console.log('[legacyMigration] migrated workspace settings:', partial);
    }

    // Relay系はグローバルへ移行
    if (map['relay_event_id']) {
      try { await GlobalSettingsService.save('relay_event_id', map['relay_event_id']); } catch {}
    }
    if (map['pcid'] || map['pc_id']) {
      try { await GlobalSettingsService.save('pcid', (map['pcid'] || map['pc_id'])); } catch {}
    }
    // 旧データの削除は安全性のため後続フェーズで実施（ここでは移行のみ）
  } catch (e) {
    console.warn('[legacyMigration] skip migration:', e);
  }
}
