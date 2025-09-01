// ConnectivityProbeService: Relay到達性を軽量に確認（Autoモード用）

export type ProbeResult = {
  ok: boolean;
  status?: number;
  error?: string;
  version?: number;
};

async function fetchWithTimeout(url: string, timeoutMs = 2000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    return res;
  } finally {
    clearTimeout(id);
  }
}

import { PROTOCOL_VERSION } from '../protocol/version';

export async function checkRelayHealth(baseUrl: string): Promise<ProbeResult> {
  try {
    const url = baseUrl.replace(/\/$/, '') + '/healthz';
    const res = await fetchWithTimeout(url, 2000);
    if (!res.ok) return { ok: false, status: res.status };
    let version: number | undefined;
    try {
      const data = await res.json();
      version = typeof data?.version === 'number' ? data.version : undefined;
    } catch (_) {}
    if (version !== undefined && version !== PROTOCOL_VERSION) {
      return { ok: false, status: res.status, version };
    }
    return { ok: true, status: res.status, version: version ?? undefined };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
