import { invoke } from '@tauri-apps/api/core';
import { GlobalSettingsService } from './globalSettings';

type ActivateInput = { licenseCode: string };

export async function getLicenseEndpoint(): Promise<string> {
  try {
    const eff = GlobalSettingsService.getEffective() || await GlobalSettingsService.loadEffective();
    const ep = (eff as any)?.license?.endpoint as string | undefined;
    if (ep) return ep.replace(/\/$/, '');
  } catch {}
  return 'https://license.nuriemon.jp';
}

export async function activateDevice(input: ActivateInput & { pcId: string; platform?: string; appVersion?: string }): Promise<{ ok: true } | { ok: false; error?: string }> {
  const endpoint = await getLicenseEndpoint();
  try {
    const res = await fetch(`${endpoint}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ licenseCode: input.licenseCode, device: { pcId: input.pcId, platform: input.platform || navigator.userAgent, appVersion: input.appVersion || '' } }),
    });
    if (!res.ok) {
      let code: string | undefined;
      try { const j = await res.json(); code = j?.error?.code; } catch {}
      return { ok: false, error: code || `HTTP_${res.status}` };
    }
    const data = await res.json();
    const token: string | undefined = data?.deviceToken;
    if (!token) return { ok: false, error: 'E_NO_TOKEN' };
    await saveDeviceToken(token);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function refreshDeviceToken(): Promise<void> {
  const endpoint = await getLicenseEndpoint();
  const token = await loadDeviceToken();
  if (!token) return;
  try {
    const res = await fetch(`${endpoint}/token/refresh`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    const newToken = data?.deviceToken as string | undefined;
    if (newToken) await saveDeviceToken(newToken);
  } catch {}
}

export async function saveDeviceToken(token: string): Promise<void> {
  await invoke('save_license_token', { token });
}
export async function loadDeviceToken(): Promise<string | null> {
  try { return await invoke<string | null>('load_license_token'); } catch { return null; }
}
export async function deleteDeviceToken(): Promise<void> {
  try { await invoke('delete_license_token'); } catch {}
}

export function parseJwtExp(token: string): number | null {
  try { const p = JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); return typeof p?.exp === 'number' ? p.exp : null; } catch { return null; }
}

