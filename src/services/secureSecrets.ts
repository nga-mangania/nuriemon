import { invoke } from '@tauri-apps/api/core';
import { GlobalSettingsService } from './globalSettings';

type Env = 'staging' | 'production';

// In-memory fallback when OS keychain is unavailable (e.g., some Linux envs)
const memStore: Record<Env, string | undefined> = { staging: undefined, production: undefined };
let usingMemoryFallback = false;

export function isUsingMemoryFallback(): boolean {
  return usingMemoryFallback;
}

export async function setEventSetupSecret(env: Env, secret: string): Promise<void> {
  try {
    await invoke('save_event_secret', { env, secret });
    usingMemoryFallback = false;
  } catch (e: any) {
    console.warn('[secureSecrets] save_event_secret fallback to memory:', e?.message || String(e));
    memStore[env] = secret;
    usingMemoryFallback = true;
  }
}

export async function getEventSetupSecret(env: Env): Promise<string | null> {
  try {
    const v = await invoke<string | null>('load_event_secret', { env });
    usingMemoryFallback = false;
    return v ?? null;
  } catch (e: any) {
    console.warn('[secureSecrets] load_event_secret fallback to memory:', e?.message || String(e));
    usingMemoryFallback = true;
    return memStore[env] ?? null;
  }
}

export async function deleteEventSetupSecret(env: Env): Promise<void> {
  try {
    await invoke('delete_event_secret', { env });
    usingMemoryFallback = false;
  } catch (e: any) {
    console.warn('[secureSecrets] delete_event_secret (memory only):', e?.message || String(e));
    memStore[env] = undefined;
    usingMemoryFallback = true;
  }
}

// Helper: map current relay_env setting to Env
export async function currentRelayEnvAsSecretEnv(): Promise<Env> {
  const env = (await GlobalSettingsService.get('relay_env')) || 'prod';
  return env === 'stg' ? 'staging' : 'production';
}

