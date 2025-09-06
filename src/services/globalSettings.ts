import { invoke } from '@tauri-apps/api/core';

export type EffectiveSettings = {
  version: string;
  relay: {
    baseUrl?: string;
    eventId?: string;
    pcId?: string;
    wsProtocol?: string; // v1
  };
  license?: {
    endpoint?: string;
    activationRequired?: boolean;
  };
  defaults: {
    operationMode: 'auto'|'relay'|'local';
  };
  ui: {
    hideRelaySettings?: boolean;
    lockRelaySettings?: boolean;
  };
  features?: { noDelete?: boolean };
  meta?: Record<string, any>;
};

const codeDefaults: EffectiveSettings = {
  version: '1',
  relay: { wsProtocol: 'v1' },
  license: { endpoint: 'https://license.nuriemon.jp', activationRequired: false },
  defaults: { operationMode: 'auto' },
  ui: { hideRelaySettings: false, lockRelaySettings: false },
  features: { noDelete: false },
};

function deepMerge<T>(base: any, over: any): T {
  if (!over) return base;
  const out: any = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(over)) {
    const v = (over as any)[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = deepMerge(out[k] || {}, v);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

let effectiveCache: EffectiveSettings | null = null;
let lockRelay = false;

export class GlobalSettingsService {
  static reset() { effectiveCache = null; }

  static async save(key: string, value: string): Promise<void> {
    await invoke('save_global_setting', { key, value });
  }

  static async get(key: string): Promise<string | null> {
    try {
      const value = await invoke<string | null>('get_global_setting', { key });
      return value ?? null;
    } catch (e) {
      console.error('[GlobalSettingsService] get error:', e);
      return null;
    }
  }

  static async loadEffective(): Promise<EffectiveSettings> {
    if (effectiveCache) return effectiveCache;
    // 1) read bundle/user/env provisioning JSONs
    const bundleStr = await invoke<string | null>('read_bundle_global_settings').catch(() => null) as any as string | null;
    const userStr = await invoke<string | null>('read_user_provisioning_settings').catch(() => null) as any as string | null;
    const envProvStr = await invoke<string | null>('read_env_provisioning_settings').catch(() => null) as any as string | null;
    const envOverridesStr = await invoke<string | null>('read_env_overrides').catch(() => null) as any as string | null;
    let bundle = safeJson(bundleStr);
    let user = safeJson(userStr);
    let envp = safeJson(envProvStr);
    let envk = safeJson(envOverridesStr);
    // 2) merge: codeDefaults <- bundle <- user <- env provisioning file <- internal saved <- env key overrides (highest)
    let eff = deepMerge<EffectiveSettings>(codeDefaults, bundle);
    eff = deepMerge<EffectiveSettings>(eff, user);
    eff = deepMerge<EffectiveSettings>(eff, envp);
    lockRelay = !!eff?.ui?.lockRelaySettings;
    // 3) internal saved values (unless locked)
    const savedEventId = await GlobalSettingsService.get('relay_event_id');
    const savedPcid = await GlobalSettingsService.get('pcid');
    // baseUrlは既存のresolveBaseUrlで決まる（ここでは保存値を採用しない）
    if (!lockRelay) {
      if (savedEventId) eff.relay.eventId = savedEventId;
      if (savedPcid) eff.relay.pcId = savedPcid;
    } else {
      // ロック時はプロビジョニング値を優先（何もない場合のみ内部を穴埋め）
      if (!eff.relay.eventId && savedEventId) eff.relay.eventId = savedEventId;
      if (!eff.relay.pcId && savedPcid) eff.relay.pcId = savedPcid;
    }
    // env key overrides are last
    eff = deepMerge<EffectiveSettings>(eff, envk);
    // 4) pcId 未設定なら生成して保存
    if (!eff.relay.pcId) {
      const pid = generateDefaultPcid();
      eff.relay.pcId = pid;
      try { await GlobalSettingsService.save('pcid', pid); } catch {}
    }
    // 5) log
    try { console.log('[global-settings] effective:', eff); } catch {}
    effectiveCache = eff;
    return eff;
  }

  static getEffective(): EffectiveSettings | null {
    return effectiveCache;
  }

  static async setUserEventId(eventId: string): Promise<void> {
    await invoke('set_user_event_id', { eventId, event_id: eventId } as any);
    // 反映のためキャッシュを破棄
    GlobalSettingsService.reset();
    await GlobalSettingsService.loadEffective();
  }
}

function generateDefaultPcid(): string {
  const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
  let s = '';
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `pc-${s}`;
}

function safeJson(s?: string | null): any {
  if (!s) return {};
  try { const j = JSON.parse(s); return j && typeof j === 'object' ? j : {}; } catch { return {}; }
}
