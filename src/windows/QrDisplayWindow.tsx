import React, { useEffect, useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useWorkspaceStore, loadStateFromFile } from '../stores/workspaceStore';
import { AppSettingsService } from '../services/database';
import { GlobalSettingsService } from '../services/globalSettings';
import { checkRelayHealth } from '../services/connectivityProbe';
import { pendingSid, registerPc, retryWithBackoff, resolveBaseUrl, getSidStatus } from '../services/relayClient';
import { loadDeviceToken } from '../services/licenseClient';
import styles from './QrDisplayWindow.module.scss';
// Relayブリッジはグローバル（App側）で起動するためQR画面では起動しない

interface QrSession {
  imageId: string;
  sessionId: string;
  qrCode: string;
  connected: boolean;
  envKey: string;
  blockedReason?: 'missing' | 'invalid' | 'error';
  errorMessage?: string;
}

export const QrDisplayWindow: React.FC = () => {
  console.log('[QrDisplayWindow] Component rendering...'); // ログ1: コンポーネントがレンダリングされているか
  
  const images = useWorkspaceStore(state => state.images);
  console.log('[QrDisplayWindow] Images from Zustand:', images); // ログ2: ストアから取得した直後のデータ
  
  const [sessions, setSessions] = useState<Map<string, QrSession>>(new Map());
  const [isServerStarted, setIsServerStarted] = useState(false);
  const [serverPort, setServerPort] = useState<number | null>(null);
  const [operationMode, setOperationMode] = useState<'auto'|'relay'|'local'>('auto');
  const [relayBaseUrl, setRelayBaseUrl] = useState<string>('https://ctrl.nuriemon.jp');
  const [relayEventId, setRelayEventId] = useState<string>('');
  const [pcId, setPcId] = useState<string>('');
  // 秘密鍵はOSキーチェーンから取得（UIからは参照しない）
  const [useRelay, setUseRelay] = useState<boolean>(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [regenTick, setRegenTick] = useState<number>(0);
  const [showDebug, setShowDebug] = useState<boolean>(false);
  const showDebugRef = useRef<boolean>(false);
  useEffect(() => { showDebugRef.current = showDebug; }, [showDebug]);
  // Relay時のサムネイルをデータURLで保有（convertFileSrcは保存先により不安定なため）
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  // mark as used to satisfy TS compile (used only for dev overlay toggles)
  if (false) { console.log(debugLogs.length, visibleIds.size); }
  const visibleIdsRef = useRef<Set<string>>(new Set());
  const onVisibleChange = (id: string, visible: boolean) => {
    const next = new Set(visibleIdsRef.current);
    if (visible) next.add(id); else next.delete(id);
    visibleIdsRef.current = next;
    setVisibleIds(next);
  };
  const inflightRef = useRef<Set<string>>(new Set());
  const licenseAlertShownRef = useRef<boolean>(false);
  const [licenseBlocked, setLicenseBlocked] = useState<boolean>(false);
  const [licenseBlockedReason, setLicenseBlockedReason] = useState<'missing' | 'invalid' | null>(null);
  const generalAlertShownRef = useRef<boolean>(false);
  const debug = (msg: string) => {
    try {
      const ts = new Date().toISOString().split('T')[1]?.replace('Z','');
      const line = `[${ts}] ${msg}`;
      // コンソールにも出す
      console.log('[QRDEBUG]', line);
      if (showDebugRef.current) {
        setDebugLogs(prev => {
          const next = prev.length > 400 ? prev.slice(prev.length - 400) : prev.slice();
          next.push(line);
          return next;
        });
      }
    } catch {}
  };
  
  // メタデータから表示用データを生成
  const processedImages = images.filter(img => img.type === 'processed');

  // Relay の有効/不足判定（表示の出し分け用）
  const relayActive = (operationMode === 'relay') || (operationMode === 'auto' && useRelay);
  // UI の表示準備完了判定（レンダリング条件と生成スケジューラで共有）
  const uiReady = isServerStarted || relayActive;
  const missingRelay = relayActive && (!relayEventId || !pcId);

  // 条件が整ったら一時的なバナーを自動クリア
  useEffect(() => {
    if (!missingRelay && (useRelay || isServerStarted)) {
      if (banner) setBanner(null);
    }
  }, [missingRelay, useRelay, isServerStarted]);

  // (DBリフレッシュは補助方針に戻す)

  // セッションキーを生成（eventId:pcid:baseURL:imageId）
  const buildSessionKey = (imageId: string) => {
    return `${relayEventId || ''}:${pcId || ''}:${(relayBaseUrl || '').replace(/\/$/, '')}:${imageId}`;
  };

  // 設定値の再読込ヘルパ
  const reloadAppSettings = async () => {
    try {
      const mode = await AppSettingsService.getAppSetting('operation_mode');
      if (mode === 'relay' || mode === 'local' || mode === 'auto') setOperationMode(mode);
      // effective を優先（プロビジョニング/ENVを尊重）
      await GlobalSettingsService.loadEffective();
      const eff = GlobalSettingsService.getEffective();
      const base = await resolveBaseUrl();
      if (base) setRelayBaseUrl(base);
      const eid = (eff?.relay?.eventId || await GlobalSettingsService.get('relay_event_id')) || '';
      if (eid) setRelayEventId(eid);
      let pid = (eff?.relay?.pcId || await GlobalSettingsService.get('pcid')) || '';
      if (!pid) {
        // 新しいワークスペースなどで未設定なら自動生成して保存
        pid = generateDefaultPcid();
        try { await GlobalSettingsService.save('pcid', pid); } catch {}
      }
      if (pid) setPcId(pid);
      debug(`settings: mode=${mode} base=${base} eid=${eid} pcid=${pid}`);
    } catch (_) {}
  };

  function generateDefaultPcid(): string {
    const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
    let s = '';
    for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
    return `pc-${s}`;
  }

  // ウィンドウ起動時に一度だけファイルから状態を読み込む
  useEffect(() => {
    console.log('[QrDisplayWindow] Loading state from file...');
    loadStateFromFile();
    // 設定読み込み（effectiveを優先）
    (async () => {
      await GlobalSettingsService.loadEffective();
      await reloadAppSettings();
    })();
  }, []);

  // （除去）

  // 他ウィンドウからの更新通知をリッスンする
  useEffect(() => {
    const unlisteners: Array<Promise<() => void>> = [];
    const add = (event: string) => {
      const p = listen(event, () => {
        console.log(`[QrDisplayWindow] Received ${event}. Reloading state.`);
        loadStateFromFile();
        reloadAppSettings();
        setRegenTick(t => t + 1);
      });
      unlisteners.push(p);
    };
    add('image-list-updated');
    add('store-updated'); // 互換のため残す
    add('data-changed');  // 念のためDBイベントも拾う
    add('workspace-data-loaded'); // ワークスペース切替時
    add('app-settings-changed'); // 設定変更時

    return () => {
      // 二重解除や未登録時の例外/非同期拒否を握りつぶし、安全にクリーンアップ
      unlisteners.forEach(p => p
        .then(fn => {
          try {
            const r = (fn as any)();
            if (r && typeof (r as any).catch === 'function') {
              (r as any).catch(() => {});
            }
          } catch (_) {}
        })
        .catch(() => {})
      );
    };
  }, []);

  // 設定が変わっても既存QRは保持し、必要な分のみ再生成（負担軽減）
  useEffect(() => {
    setRegenTick(t => t + 1);
  }, [operationMode, relayEventId, pcId, relayBaseUrl, useRelay]);

  // Webサーバーの起動
  useEffect(() => {
    const initialize = async () => {
      try {
        // 先に設定をロードしてから分岐判定（初期Auto→Local誤判定を避ける）
        await reloadAppSettings();
        // 状態更新の反映を待たずに、直近の値を直接取得して判定する
        const mode = (await AppSettingsService.getAppSetting('operation_mode')) as 'auto'|'relay'|'local' | null;
        await GlobalSettingsService.loadEffective();
        const eff = GlobalSettingsService.getEffective();
        const eid = eff?.relay?.eventId || await GlobalSettingsService.get('relay_event_id');
        const base = await resolveBaseUrl();
        if (base) setRelayBaseUrl(base);
        if (eid) setRelayEventId(eid);
        if (mode === 'relay' || mode === 'auto') {
          try {
            const res = await checkRelayHealth(base || relayBaseUrl);
            debug(`healthz: status=${res.status} ok=${res.ok} version=${res.version}`);
            const canRelay = res.ok && !!(eid || relayEventId);
            setUseRelay(canRelay);
            if (mode === 'relay') {
              // Relay固定時はローカルサーバ起動はスキップ。ただしUIはreadyにする
              setIsServerStarted(true);
              setServerPort(null);
              // 生成トリガ
              setRegenTick(t => t + 1);
              return;
            }
          } catch (_) { setUseRelay(false); }
        }
        // React StrictMode での二重実行対策（開発時）
        const g: any = window as any;
        if (g.__NURIEMON_WEB_SERVER_PORT) {
          console.log('[QrDisplayWindow] Web server already started on port:', g.__NURIEMON_WEB_SERVER_PORT);
          debug(`local web server already started on port=${g.__NURIEMON_WEB_SERVER_PORT}`);
          setServerPort(g.__NURIEMON_WEB_SERVER_PORT);
          setIsServerStarted(true);
          return;
        }

        // Webサーバーの起動（すでに起動済みならポート番号）
        debug('start_web_server invoke...');
        const port = await invoke<number>('start_web_server');
        console.log('[QrDisplayWindow] Web server started on port:', port);
        debug(`start_web_server started on port=${port}`);
        g.__NURIEMON_WEB_SERVER_PORT = port;
        setServerPort(port);
        setIsServerStarted(true);
      } catch (error) {
        console.error('[QrDisplayWindow] Webサーバーの起動に失敗しました:', error);
        debug(`start_web_server failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    
    initialize();
  }, []);


  // モバイル接続イベントのリスナー
  useEffect(() => {
    const unlisten = listen('mobile-connected', (event) => {
      const { sessionId, imageId } = event.payload as { sessionId: string; imageId: string };
      setSessions(prev => {
        const newSessions = new Map(prev);
        const session = newSessions.get(imageId);
        if (session && session.sessionId === sessionId) {
          session.connected = true;
        }
        return newSessions;
      });
    });

    return () => {
      unlisten.then(fn => { try { fn(); } catch (_) {} }).catch(() => {});
    };
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    (async () => {
      try {
        cleanup = await listen('pc-bridge-status', (event) => {
          const payload: any = event.payload || {};
          const state = typeof payload === 'string' ? payload : payload.state;
          if (state === 'token-missing') {
            setLicenseBlocked(true);
            setLicenseBlockedReason(prev => prev || 'missing');
          }
          if (state === 'auth-sent' || state === 'ack' || state === 'open') {
            licenseAlertShownRef.current = false;
            setLicenseBlocked(false);
            setLicenseBlockedReason(null);
            setBanner(null);
            setSessions(prev => {
              let changed = false;
              const next = new Map(prev);
              prev.forEach((value, key) => {
                if ((value as any)?.blockedReason) {
                  next.delete(key);
                  changed = true;
                }
              });
              return changed ? next : prev;
            });
            setRegenTick(t => t + 1);
          }
        });
      } catch {}
    })();
    return () => { try { cleanup && cleanup(); } catch {} };
  }, []);

  // QRコードの生成
  const generateQr = async (imageId: string) => {
    debug(`generateQr called imageId=${imageId}`);
    if (inflightRef.current.has(imageId)) {
      debug(`generateQr skipped (inflight) imageId=${imageId}`);
      return;
    }
    generalAlertShownRef.current = false;
    setSessions(prev => {
      const next = new Map(prev);
      const session = next.get(imageId);
      if (session && (session as any).blockedReason) {
        next.delete(imageId);
      }
      return next;
    });
    inflightRef.current.add(imageId);
    const relayActive = operationMode === 'relay' || (operationMode === 'auto' && useRelay);
    if (!relayActive && !isServerStarted) {
      // 初期化未完了。少し待ってから再試行（regenTickで自動再試行）
      setBanner('初期化中です。数秒後に自動再試行します…');
      debug(`skip generateQr(imageId=${imageId}) because not ready`);
      inflightRef.current.delete(imageId);
      return;
    }

    try {
      const sessionKey = buildSessionKey(imageId);
      let session: QrSession;
      const envKey = `${relayBaseUrl}|${relayEventId}|${pcId}|${operationMode}`;
      if (relayActive) {
        if (licenseBlocked) {
          handleLicenseBlocking(licenseBlockedReason || 'missing', imageId, sessionKey, envKey);
          inflightRef.current.delete(imageId);
          return;
        }
        const bearer = await loadDeviceToken();
        if (!bearer) {
          handleLicenseBlocking('missing', imageId, sessionKey, envKey);
          inflightRef.current.delete(imageId);
          return;
        }
        // Relay: sid を発行し、pending-sid に登録
        if (!relayEventId || !pcId) {
          // Autoモード時はローカルへフォールバック、Relay固定時はエラー表示
          if (operationMode === 'relay') {
            setBanner('Relay設定が不足しています（イベントID/PCID）。設定画面で確認してください。');
            debug('missing relayEventId or pcid in relay mode');
            inflightRef.current.delete(imageId);
            return;
          } else {
            debug('missing relayEventId/pcid in auto; fallback to local');
            const result = await invoke<{ sessionId: string; qrCode: string; imageId: string }>('generate_qr_code', { imageId });
            session = {
              imageId: result.imageId,
              sessionId: result.sessionId,
              qrCode: result.qrCode,
              connected: false,
              envKey,
            };
            setBanner('Relay設定が未完了のため、ローカル接続に切替えました');
            // store and return
            setSessions(prev => {
              const m = new Map(prev);
              (session as any).sessionKey = sessionKey;
              m.set(imageId, session);
              return m;
            });
            inflightRef.current.delete(imageId);
            return;
          }
        }

        // 必要ならPC登録（ベストエフォート + リトライ）
        try {
          debug(`registerPc start eid=${relayEventId} pcid=${pcId}`);
          const r = await retryWithBackoff(() => registerPc({ eventId: relayEventId, pcid: pcId }));
          debug(`registerPc done ok=${r.ok} status=${(r as any).status} code=${(r as any).code} err=${(r as any).error}`);
          if (!r.ok) {
            const errCode = (r as any)?.code || (r as any)?.error;
            const status = (r as any)?.status;
            if (errCode === 'E_MISSING_TOKEN' || errCode === 'E_TOKEN_REQUIRED') {
              handleLicenseBlocking('missing', imageId, sessionKey, envKey);
              inflightRef.current.delete(imageId);
              return;
            }
            if (errCode === 'E_BAD_TOKEN' || status === 401) {
              handleLicenseBlocking('invalid', imageId, sessionKey, envKey);
              inflightRef.current.delete(imageId);
              return;
            }
            if (operationMode === 'auto') {
              setBanner('Relay接続に失敗したためローカル接続に切替えました');
              debug('registerPc failed; fallback to local');
              const result = await invoke<{ sessionId: string; qrCode: string; imageId: string }>('generate_qr_code', { imageId });
              session = {
                imageId: result.imageId,
                sessionId: result.sessionId,
                qrCode: result.qrCode,
                connected: false,
                envKey,
              };
              setSessions(prev => {
                const m = new Map(prev);
                (session as any).sessionKey = sessionKey;
                m.set(imageId, session);
                return m;
              });
              inflightRef.current.delete(imageId);
              return;
            }
            handleGeneralFailure('QRの事前登録に失敗しました。時間をおいて再試行してください。', imageId, sessionKey, envKey);
            inflightRef.current.delete(imageId);
            return;
          }
        } catch (e:any) {
          debug(`registerPc error ${e?.message || e}`);
          handleGeneralFailure('Relay 接続に失敗しました。ネットワーク環境を確認してから再試行してください。', imageId, sessionKey, envKey);
          inflightRef.current.delete(imageId);
          return;
        }

        const sid = generateSid();
        const ttl = 90;
        debug(`pendingSid start eid=${relayEventId} pcid=${pcId} sid=${sid} ttl=${ttl}`);
        const res = await retryWithBackoff(() => pendingSid({ eventId: relayEventId, pcid: pcId, sid, ttl }));
        debug(`pendingSid done ok=${res.ok} status=${(res as any).status} code=${(res as any).code} err=${(res as any).error}`);
        if (!res.ok) {
          console.error('[QrDisplayWindow] pending-sid 登録に失敗:', res);
          setBanner(`pending-sid失敗: status=${(res as any).status || '-'} code=${(res as any).code || (res as any).error || '-'}`);
          const errCode = (res as any)?.error || (res as any)?.code;
          if (errCode === 'E_MISSING_TOKEN' || errCode === 'E_TOKEN_REQUIRED') {
            handleLicenseBlocking('missing', imageId, sessionKey, envKey);
            return;
          }
          if (errCode === 'E_BAD_TOKEN') {
            handleLicenseBlocking('invalid', imageId, sessionKey, envKey);
            return;
          }
          if (operationMode === 'auto') {
            // Auto時はLocalへフォールバック
            setBanner('ネットワーク不安定のためローカル接続に切替えました');
            debug('fallback to local');
            const result = await invoke<{ sessionId: string; qrCode: string; imageId: string }>('generate_qr_code', { imageId });
            session = {
              imageId: result.imageId,
              sessionId: result.sessionId,
              qrCode: result.qrCode,
              connected: false,
              envKey,
            };
          } else {
            handleGeneralFailure('QRの事前登録に失敗しました。時間をおいて再試行してください。', imageId, sessionKey, envKey);
            debug('pending-sid failed in relay mode; abort');
            return;
          }
        } else {
          // Relay での事前登録成功 → 一時バナーをクリア
          setBanner(null);
          const base = (relayBaseUrl || 'https://ctrl.nuriemon.jp').replace(/\/$/, '');
          // 画像ごとのコントローラー割当: img(=imageId)を明示
          const qrUrl = `${base}/app/#e=${encodeURIComponent(relayEventId)}&sid=${encodeURIComponent(sid)}&img=${encodeURIComponent(imageId)}`;
          // Relay用URLからQR画像(Data URI)を生成
          let qrDataUrl = qrUrl;
          try {
            qrDataUrl = await invoke<string>('generate_qr_from_text', { text: qrUrl });
            debug('QR data URL generated');
          } catch (e) {
            console.warn('[QrDisplayWindow] generate_qr_from_text failed, falling back to raw URL as img src');
            debug('QR data URL generation failed; fallback to URL');
          }
          session = {
            imageId,
            sessionId: sid,
            qrCode: qrDataUrl,
            connected: false,
            envKey,
          };
          // Relay: poll claimed status and update connected flag
          const poll = setInterval(async () => {
            try {
              const st = await getSidStatus(relayEventId, sid);
              debug(`sid-status: ok=${st.ok} status=${(st as any).status} connected=${(st as any).data?.connected}`);
              if (st.ok && (st as any).data?.connected) {
                setSessions(prev => {
                  const m = new Map(prev);
                  const s = m.get(imageId);
                  if (s) s.connected = true;
                  return m;
                });
                debug('connected=true (sid claimed)');
                clearInterval(poll);
              }
            } catch {}
          }, 2000);
        }
      } else {
        const result = await invoke<{ sessionId: string; qrCode: string; imageId: string }>('generate_qr_code', { imageId });
        session = {
          imageId: result.imageId,
          sessionId: result.sessionId,
          qrCode: result.qrCode,
          connected: false,
          envKey,
        };
        debug(`local QR generated sessionId=${result.sessionId}`);
      }

      setSessions(prev => {
        const newSessions = new Map(prev);
        // セッションキーで上書き判定（設定変更時の古いQRを無効化）
        (session as any).sessionKey = sessionKey;
        newSessions.set(imageId, session);
        return newSessions;
      });
      debug(`session stored for imageId=${imageId}`);

      // タイマーの開始
      if (!relayActive) {
        startTimer(imageId, session.sessionId);
      }
    } catch (error) {
      console.error('QRコードの生成に失敗しました:', error);
      debug(`generateQr error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      inflightRef.current.delete(imageId);
    }
  };

  // 設定が変わったら既存セッションをクリアして再生成させる
  // ↑ 個別クリアは上の設定変更effectで実施

  // 再生成トリガや画像リスト変更時に、未生成のQRを補完生成（同一画像の重複生成を抑止）
  useEffect(() => {
    const ready = uiReady;
    const envKey = `${relayBaseUrl}|${relayEventId}|${pcId}|${operationMode}`;
    if (!ready) return;
    const relayActive = operationMode === 'relay' || (operationMode === 'auto' && useRelay);
    if (licenseBlocked && relayActive) {
      return;
    }
    let delay = 0;
    const stepMs = 60;
    const noVisible = visibleIdsRef.current.size === 0;
    const targetList = noVisible ? processedImages.slice(0, 3) : processedImages;
    targetList.forEach(image => {
      const s = sessions.get(image.id);
      const desiredKey = buildSessionKey(image.id);
      const valid = !!s && (s as any).envKey === envKey && (s as any).sessionKey === desiredKey;
      const visible = noVisible ? true : visibleIdsRef.current.has(image.id);
      if (!valid && !inflightRef.current.has(image.id) && visible) {
        setTimeout(() => { generateQr(image.id).catch(() => {}); }, delay);
        delay += stepMs;
      }
    });
  }, [regenTick, processedImages, sessions, operationMode, useRelay, relayBaseUrl, relayEventId, pcId, isServerStarted, uiReady, visibleIds, licenseBlocked]);

  // グローバル再生成ボタン
  const regenerateAll = () => {
    debug('manual regenerate all clicked');
    // 既存セッションは温存（環境キーが変わったものだけ個別再生成）
    inflightRef.current.clear();
    setRegenTick(t => t + 1);
  };


  // Relay時（ローカルサーバ未使用）のサムネイル読み込み
  useEffect(() => {
    const loadThumbs = async () => {
      if (serverPort) return;
      const { loadImage } = await import('../services/imageStorage');
      const { downscaleDataUrl } = await import('../utils/image');
      const map = new Map(thumbs);
      let delay = 0;
      const step = 30; // 30ms間隔でゆっくり読み込む
      for (const image of processedImages) {
        if (!map.get(image.id)) {
          setTimeout(async () => {
            try {
              const full = await loadImage(image as any);
              const small = await downscaleDataUrl(full, 200, 0.8);
              map.set(image.id, small);
              // setStateはまとめず小出し（UIブロック回避）
              setThumbs(new Map(map));
            } catch (e) {
              console.warn('[QrDisplayWindow] thumbnail load failed:', e);
            }
          }, delay);
          delay += step;
        }
      }
    };
    loadThumbs();
    // 依存にthumbsは入れない（逐次更新）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processedImages, serverPort]);


  // デバッグトグル（Dキー）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Cmd/Ctrl + D : デバッグログの表示切替
      if ((e.key === 'd' || e.key === 'D') && (e.metaKey || e.ctrlKey)) {
        setShowDebug(s => !s);
      }
      // Cmd + Opt + I : DevTools を開く
      if ((e.key === 'I') && e.metaKey && e.altKey) {
        try { invoke('open_devtools', { window_label: 'qr-display' } as any); } catch {}
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // タイマー処理
  const startTimer = (imageId: string, sessionId: string) => {
    const interval = setInterval(async () => {
      try {
        const status = await invoke<{ connected: boolean }>('get_qr_session_status', { sessionId });
        setSessions(prev => {
          const newSessions = new Map(prev);
          const session = newSessions.get(imageId);
          if (session) {
            session.connected = !!status.connected;
            // 接続済みになったらポーリング停止
            if (session.connected) {
              clearInterval(interval);
            }
          }
          return newSessions;
        });
      } catch (error) {
        // 一時的なエラーは無視（サーバーはローカル）
      }
    }, 3000); // 負荷軽減のため3秒間隔
  };

  // Crockford系 base32（I/O/L除外）の10桁を生成（暫定）
  function generateSid(): string {
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let out = '';
    for (let i = 0; i < 10; i++) {
      out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return out;
  }

  function handleLicenseBlocking(kind: 'missing' | 'invalid', imageId?: string, sessionKey?: string, envKey?: string) {
    setLicenseBlocked(true);
    setLicenseBlockedReason(kind);
    const message = kind === 'missing'
      ? 'ライセンスが未有効化のため Relay へ接続できません。設定画面でライセンスコードを有効化してから再試行してください。'
      : '保存済みのライセンス情報が無効になっています。設定画面でライセンスを再有効化してください。';
    const bannerMessage = kind === 'missing'
      ? 'ライセンスを有効化してから再試行してください'
      : 'ライセンス情報を再有効化してください';
    if (!licenseAlertShownRef.current) {
      try { alert(message); } catch {}
      licenseAlertShownRef.current = true;
    }
    setBanner(bannerMessage);
    debug(kind === 'missing' ? 'missing device token' : 'invalid device token');
    if (imageId && sessionKey && envKey) {
      setSessions(prev => {
        const existing = prev.get(imageId);
        if (existing && (existing as any).blockedReason === kind) {
          return prev;
        }
        const next = new Map(prev);
        const placeholder: QrSession = {
          imageId,
          sessionId: '',
          qrCode: '',
          connected: false,
          envKey,
          blockedReason: kind,
        };
        (placeholder as any).sessionKey = sessionKey;
        next.set(imageId, placeholder);
        return next;
      });
    }
  }

  function handleGeneralFailure(message: string, imageId: string, sessionKey: string, envKey: string) {
    setBanner(message);
    if (!generalAlertShownRef.current) {
      try { alert(message); } catch {}
      generalAlertShownRef.current = true;
    }
    setSessions(prev => {
      const next = new Map(prev);
      const placeholder: QrSession = {
        imageId,
        sessionId: '',
        qrCode: '',
        connected: false,
        envKey,
        blockedReason: 'error',
        errorMessage: message,
      };
      (placeholder as any).sessionKey = sessionKey;
      next.set(imageId, placeholder);
      return next;
    });
  }

  return (
    <ErrorBoundary>
    <div className={styles.container}>
      <h1 className={styles.title}>QRコード - ぬりえもん</h1>
      {(() => {
        const displayBanner = missingRelay
          ? 'Relay設定が不足しています（イベントID/PCID）。設定画面で確認してください。'
          : banner;
        return displayBanner ? (
        <div className={styles.banner}>
          {displayBanner}
        </div>
        ) : null;
      })()}

      <>
        {/* Debug overlay and server port display removed for cleaner QR scanning */}

        <div className={styles.controls}>
          <button onClick={regenerateAll} style={{ fontSize: 12 }}>すべて再生成</button>
        </div>
        <div className={styles.imageGrid}>
          {processedImages.length === 0 ? (
            <div className={styles.noImages}>
              画像がありません
            </div>
          ) : (
            processedImages.map(image => (
              <ImageQrItem
                key={image.id}
                image={image}
                session={sessions.get(image.id)}
                onGenerateQr={() => generateQr(image.id)}
                ready={uiReady}
                serverPort={serverPort}
                thumbUrl={thumbs.get(image.id) || ''}
                onVisible={onVisibleChange}
              />
            ))
          )}
        </div>
      </>
    </div>
    </ErrorBoundary>
);
};

// 簡易エラーバウンダリ：QR画面全体を保護し、例外時に情報を表示
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; message?: string }>{
  constructor(props: any){
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(err: any){
    return { hasError: true, message: err?.message || String(err) };
  }
  componentDidCatch(error: any, info: any){
    console.error('[QrDisplayWindow/ErrorBoundary]', error, info);
  }
  render(){
    if (this.state.hasError){
      return (
        <div style={{ padding: 16, color: '#fff', background: '#300', minHeight: '100vh' }}>
          <h2>QR画面でエラーが発生しました</h2>
          <p>{this.state.message}</p>
          <p>アプリを再起動するか、設定を見直してください。</p>
        </div>
      );
    }
    return this.props.children as any;
  }
}

// 画像とQRコードを表示するアイテムコンポーネント
interface ImageQrItemProps {
  image: any;
  session?: QrSession;
  onGenerateQr: () => void;
  ready: boolean;
  serverPort: number | null;
  thumbUrl?: string;
  onVisible: (id: string, visible: boolean) => void;
}

const ImageQrItem: React.FC<ImageQrItemProps> = ({ image, session, onGenerateQr, serverPort, ready, thumbUrl, onVisible }) => {
  // 自動生成は親コンポーネント側で制御（重複生成防止）
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        onVisible(image.id, entry.isIntersecting);
      });
    }, { root: null, threshold: 0.1 });
    io.observe(el);
    return () => { try { io.disconnect(); } catch {} };
  }, [image.id, onVisible]);

  return (
    <div className={styles.imageQrItem} ref={ref}>
      <div className={styles.imageSection}>
        <img
          src={serverPort ? `http://127.0.0.1:${serverPort}/image/${image.id}` : (thumbUrl || '')}
          alt={image.originalFileName}
        />
        <div className={styles.imageName}>{image.originalFileName}</div>
      </div>
      
      <div className={styles.qrSection}>
        {session ? (
          session.blockedReason ? (
            <div className={styles.qrLoading}>
              {session.blockedReason === 'missing'
                ? 'ライセンスが未有効化です'
                : session.blockedReason === 'invalid'
                  ? 'ライセンス情報が無効です'
                  : (session.errorMessage || 'QRの生成に失敗しました')}
              <div style={{ marginTop: 6 }}>
                <button onClick={onGenerateQr} disabled={!ready} style={{ fontSize: 12 }}>再試行</button>
              </div>
            </div>
          ) : (
            <>
              <QrCodeDisplay qrCode={session.qrCode} />
              <div className={styles.qrStatus}>
                {session.connected ? (
                  <span className={styles.connected}>接続済み</span>
                ) : (
                  <span className={styles.timer}>接続待ち</span>
                )}
              </div>
              <div style={{ marginTop: 6 }}>
                <button onClick={onGenerateQr} disabled={!ready} style={{ fontSize: 12 }}>QR再生成</button>
              </div>
            </>
          )
        ) : (
          <div className={styles.qrLoading}>
            QR生成中...
            <div style={{ marginTop: 6 }}>
              <button onClick={onGenerateQr} disabled={!ready} style={{ fontSize: 12 }}>手動生成</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// QRコード表示コンポーネント
const QrCodeDisplay: React.FC<{ qrCode: string }> = ({ qrCode }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = '';
      const img = document.createElement('img');
      img.src = qrCode;
      img.style.width = '100%';
      img.style.height = '100%';
      ref.current.appendChild(img);
    }
  }, [qrCode]);

  return <div ref={ref} className={styles.qrCode} />;
};
