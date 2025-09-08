import React, { useState, useEffect } from 'react';
import { open, confirm } from '@tauri-apps/plugin-dialog';
// import { invoke } from '@tauri-apps/api/core';
import { readFile } from '@tauri-apps/plugin-fs';
import { AudioSettings } from './AudioSettings';
import { GroundSetting } from './GroundSetting';

console.log('[SettingsPage] Starting imports...');

import { emit, listen } from '@tauri-apps/api/event';
import { getAllMetadata, loadImage, deleteImage, saveBackgroundFile } from '../services/imageStorage';
import { WorkspaceManager } from '../services/workspaceManager';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { AppSettingsService } from '../services/database';
import { GlobalSettingsService } from '../services/globalSettings';
import { currentRelayEnvAsSecretEnv, deleteEventSetupSecret, getEventSetupSecret, isUsingMemoryFallback, setEventSetupSecret } from '../services/secureSecrets';
import styles from './SettingsPage.module.scss';
import { checkForUpdatesManually } from '../services/updater';
import { activateDevice, deleteDeviceToken, loadDeviceToken, parseJwtExp } from '../services/licenseClient';

console.log('[SettingsPage] All imports completed');

export function SettingsPage() {
  // Zustandストアから状態を取得
  const { 
    currentWorkspace, 
    groundPosition, 
    deletionTime, 
    backgroundUrl,
    backgroundType,
    setGroundPosition, 
    setDeletionTime,
    setBackground 
  } = useWorkspaceStore();
  
  const [isAnimationWindowOpen, setIsAnimationWindowOpen] = useState(false);
  const [isChangingWorkspace, setIsChangingWorkspace] = useState(false);
  const [operationMode, setOperationMode] = useState<'auto' | 'relay' | 'local'>('auto');
  // relayBaseUrl は UIでは直接使用しないため保持しない（effective に委譲）
  const [relayEventId, setRelayEventId] = useState<string>('');
  const [pcId, setPcId] = useState<string>('');
  const [eventSetupSecretInput, setEventSetupSecretInput] = useState<string>('');
  const [storedSecretPreview, setStoredSecretPreview] = useState<string>('');
  const [revealSecret, setRevealSecret] = useState<boolean>(false);
  const [secretFallback, setSecretFallback] = useState<boolean>(false);
  const [relayEnv, setRelayEnv] = useState<'prod'|'stg'>('prod');
  const [relayBaseUrlProd, setRelayBaseUrlProd] = useState<string>('https://ctrl.nuriemon.jp');
  const [relayBaseUrlStg, setRelayBaseUrlStg] = useState<string>('https://stg.ctrl.nuriemon.jp');
  const [pcBridgeStatus, setPcBridgeStatus] = useState<string>('idle');
  const [effectiveJson, setEffectiveJson] = useState<string>('');
  const [hideRelaySettings, setHideRelaySettings] = useState<boolean>(false);
  const [lockRelaySettings, setLockRelaySettings] = useState<boolean>(false);
  const [licenseCode, setLicenseCode] = useState<string>('');
  const [licenseStatus, setLicenseStatus] = useState<string>('未有効化');
  const [licenseExp, setLicenseExp] = useState<number | null>(null);
  
  // 背景アップロード関連のstate
  const [uploadingBackground, setUploadingBackground] = useState(false);
  const [backgroundProgress, setBackgroundProgress] = useState(0);
  
  const loadSettings = async () => {
    // Zustandストアがすでに設定を管理しているため、背景画像の読み込みのみ行う
    console.log('[SettingsPage] 現在の設定:', { 
      groundPosition, 
      deletionTime,
      currentWorkspace
    });

    // 動作モードの読み込み（デフォルト: auto）
    try {
      const mode = await AppSettingsService.getAppSetting('operation_mode');
      if (mode === 'relay' || mode === 'local' || mode === 'auto') {
        setOperationMode(mode);
      } else {
        setOperationMode('auto');
      }
    } catch (_) {
      setOperationMode('auto');
    }

    // Relay設定の読み込み
    try {
      // グローバル接続先設定
      const env = (await GlobalSettingsService.get('relay_env')) as 'prod'|'stg' | null;
      if (env === 'prod' || env === 'stg') setRelayEnv(env);
      const prod = await GlobalSettingsService.get('relay_base_url_prod');
      if (prod) setRelayBaseUrlProd(prod);
      const stg = await GlobalSettingsService.get('relay_base_url_stg');
      if (stg) setRelayBaseUrlStg(stg);
      // 互換: relay_base_url があれば現在のenvの値として扱う
      // legacy relay_base_url は effective 解決に委譲（ここでは読み込まない）
      await GlobalSettingsService.loadEffective();
      const eff = GlobalSettingsService.getEffective();
      const hide = !!eff?.ui?.hideRelaySettings;
      const lock = !!eff?.ui?.lockRelaySettings;
      setHideRelaySettings(hide);
      setLockRelaySettings(lock);
      try { setEffectiveJson(JSON.stringify(eff, null, 2)); } catch {}
      const eid = eff?.relay?.eventId || await GlobalSettingsService.get('relay_event_id');
      if (eid) setRelayEventId(eid);
      // pcid はGlobalから取得（後方互換として workspace のpc_id を読んで移行）
      let pid = eff?.relay?.pcId || await GlobalSettingsService.get('pcid');
      if (!pid) {
        const legacy = await AppSettingsService.getAppSetting('pc_id') || await AppSettingsService.getAppSetting('pcid');
        if (legacy) {
          pid = legacy;
          try { await GlobalSettingsService.save('pcid', pid); } catch {}
        }
      }
      if (pid) {
        setPcId(pid);
      } else {
        // なければ一度だけ生成
        const generated = generateDefaultPcid();
        setPcId(generated);
        try { await GlobalSettingsService.save('pcid', generated); } catch {}
      }
      // 本番UI（Relay設定を隠してロック）の場合は EVENT_SETUP_SECRET に触れない
      if (!(hide && lock)) {
        try {
          const envForSecret = await currentRelayEnvAsSecretEnv();
          const secret = await getEventSetupSecret(envForSecret);
          if (secret) setStoredSecretPreview(maskSecret(secret));
          setSecretFallback(isUsingMemoryFallback());
        } catch (_) {
          setSecretFallback(isUsingMemoryFallback());
        }
      }
      // License status (device token)
      try {
        const tok = await loadDeviceToken();
        if (tok) {
          setLicenseStatus('有効化済み');
          setLicenseExp(parseJwtExp(tok));
        } else {
          setLicenseStatus('未有効化');
          setLicenseExp(null);
        }
      } catch {}
    } catch (_) {}

    // （生成は上で一度だけ行う）

    // レガシー移行（旧: ワークスペースJSONに平文保存）
    try {
      const eff = GlobalSettingsService.getEffective();
      const hide = !!eff?.ui?.hideRelaySettings;
      const lock = !!eff?.ui?.lockRelaySettings;
      if (!(hide && lock)) {
        const legacy = await AppSettingsService.getAppSetting('event_setup_secret');
        if (legacy && legacy.trim()) {
          const envForSecret = await currentRelayEnvAsSecretEnv();
          await setEventSetupSecret(envForSecret, legacy.trim());
          try { await AppSettingsService.saveAppSetting('event_setup_secret', ''); } catch {}
          console.log('[SettingsPage] EVENT_SETUP_SECRET migrated to OS keychain');
          const s = await getEventSetupSecret(envForSecret);
          if (s) setStoredSecretPreview(maskSecret(s));
          setSecretFallback(isUsingMemoryFallback());
        }
      }
    } catch (e) {
      console.warn('[SettingsPage] legacy secret migration failed/ignored:', e);
    }
    
    // 背景画像の読み込み
    try {
      const metadata = await getAllMetadata();
      const background = metadata.find(m => (m as any).image_type === 'background');
      if (background) {
        console.log('[SettingsPage] Loading background:', background);
        const isVideo = /\.(mp4|mov)$/i.test(background.originalFileName);
        if (isVideo) {
          const { getFilePathForMetadata, filePathToUrl } = await import('../services/imageStorage');
          const abs = await getFilePathForMetadata({ ...background, image_type: 'background' } as any);
          const url = filePathToUrl(abs);
          setBackground(url, 'video');
        } else {
          const backgroundData = await loadImage(background);
          setBackground(backgroundData, 'image');
        }
      } else {
        console.log('[SettingsPage] No background found in metadata');
      }
    } catch (error) {
      console.error('背景画像の読み込みエラー:', error);
    }
  };

  useEffect(() => {
    const init = async () => {
      try {
        // 旧設定の移行（安全）
        try {
          const { migrateLegacySettingsToWorkspace } = await import('../services/legacyMigration');
          await migrateLegacySettingsToWorkspace();
        } catch (_) {}
        await loadSettings();
      } catch (error) {
        console.error('[SettingsPage] 初期化エラー:', error);
        await loadSettings();
      }
    };
    init();
  }, []);

  // PCブリッジ状態の購読（トップレベルで）
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const un = await listen('pc-bridge-status', (e) => {
          const p: any = e.payload || {};
          const s = typeof p === 'string' ? p : (p.state || JSON.stringify(p));
          setPcBridgeStatus(s);
        });
        cleanup = un;
      } catch {}
    })();
    return () => { if (cleanup) cleanup(); };
  }, []);

  // ワークスペース変更を監視
  useEffect(() => {
    const unlistenPromise = listen('workspace-data-loaded', async () => {
      console.log('[SettingsPage] ワークスペースデータ読み込み完了を検知');
      // 設定を再読み込み
      await loadSettings();

      // 背景画像も再読み込み
      try {
        const metadata = await getAllMetadata();
        const backgroundMeta = metadata.find(m => (m as any).image_type === 'background');
        if (backgroundMeta) {
          const isVideo = /\.(mp4|mov)$/i.test(backgroundMeta.originalFileName);
          if (isVideo) {
            const { getFilePathForMetadata, filePathToUrl } = await import('../services/imageStorage');
            const abs = await getFilePathForMetadata({ ...backgroundMeta, image_type: 'background' } as any);
            const url = filePathToUrl(abs);
            setBackground(url, 'video');
          } else {
            const backgroundData = await loadImage(backgroundMeta);
            setBackground(backgroundData, 'image');
          }
        } else {
          setBackground(null, 'image');
        }
      } catch (error) {
        console.error('[SettingsPage] 背景画像の再読み込みエラー:', error);
      }
    });

    return () => {
      unlistenPromise
        .then(unlisten => { try { unlisten(); } catch (_) {} })
        .catch(() => {});
    };
  }, [loadSettings, setBackground]);

  const handleGroundPositionChange = async (value: number) => {
    // Zustandストアを更新
    setGroundPosition(value);
    
    // WorkspaceManagerを使用して設定を保存
    try {
      const manager = WorkspaceManager.getInstance();
      await manager.saveWorkspaceSettings({ groundPosition: value });
    } catch (error) {
      console.error('[SettingsPage] 地面位置の保存エラー:', error);
    }
  };

  const handleDeletionTimeChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newTime = e.target.value;
    // Zustandストアを更新
    setDeletionTime(newTime);
    
    // WorkspaceManagerのみに保存（責務の一元化）
    try {
      const manager = WorkspaceManager.getInstance();
      await manager.saveWorkspaceSettings({ deletionTime: newTime });
    } catch (error) {
      console.error('[SettingsPage] 削除時間の保存エラー:', error);
    }
  };

  const handleBackgroundSelect = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: '背景ファイル',
          extensions: ['png', 'jpg', 'jpeg', 'mp4', 'mov']
        }]
      });

      if (selected) {
        setUploadingBackground(true);
        setBackgroundProgress(0);
        
        const fileData = await readFile(selected as string);
        const base64 = btoa(
          new Uint8Array(fileData).reduce(
            (data, byte) => data + String.fromCharCode(byte),
            ''
          )
        );
        
        const fileName = (selected as string).split(/[/\\]/).pop() || 'unknown';
        const extension = fileName.split('.').pop()?.toLowerCase();
        const isVideo = extension === 'mp4' || extension === 'mov';
        const mimeType = isVideo 
          ? (extension === 'mp4' ? 'video/mp4' : 'video/quicktime')
          : (extension === 'png' ? 'image/png' : 'image/jpeg');
        
        const dataUrl = `data:${mimeType};base64,${base64}`;
        
        // 即時アップロードを実行
        await handleBackgroundUploadInternal(dataUrl, fileName);
      }
    } catch (error) {
      console.error('背景ファイル選択エラー:', error);
      const errorMessage = error instanceof Error ? error.message : '不明なエラー';
      alert(`背景ファイルの選択に失敗しました: ${errorMessage}`);
    } finally {
      setUploadingBackground(false);
      setBackgroundProgress(0);
    }
  };

  // 内部アップロード関数（即時アップロード用）
  const handleBackgroundUploadInternal = async (dataUrl: string, fileName: string) => {
    try {
      setBackgroundProgress(30);
      
      // 既存の背景を削除
      const metadata = await getAllMetadata();
      const existingBackground = metadata.find(m => (m as any).image_type === 'background');
      if (existingBackground) {
        await deleteImage(existingBackground);
      }

      setBackgroundProgress(60);
      
      // 新しい背景を保存
      await saveBackgroundFile(dataUrl, fileName);
      
      setBackgroundProgress(100);
      
      // 背景を再読み込み
      await loadSettings();
      emit('background-change');
      
      // 成功メッセージを一時的に表示
      console.log('[SettingsPage] 背景アップロード成功');
      setTimeout(() => {
        setBackgroundProgress(0);
      }, 1500);
    } catch (error) {
      console.error('背景アップロードエラー:', error);
      alert(`背景のアップロードに失敗しました: ${error instanceof Error ? error.message : String(error)}`);
      setBackgroundProgress(0);
    }
  };


  const handleRemoveBackground = async () => {
    if (!backgroundUrl) return;
    
    const confirmed = await confirm('現在の背景を削除しますか？');
    if (!confirmed) return;

    try {
      const metadata = await getAllMetadata();
      const background = metadata.find(m => (m as any).image_type === 'background');
      if (background) {
        await deleteImage(background);
        setBackground(null, 'image');
        emit('background-change');
      }
    } catch (error) {
      console.error('背景削除エラー:', error);
      alert('背景の削除に失敗しました');
    }
  };

  const openAnimationWindow = async () => {
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      
      const animationWindow = new WebviewWindow('animation', {
        url: '/animation',
        title: 'ぬりえもん - アニメーション',
        width: 1200,
        height: 800,
        resizable: true,
        alwaysOnTop: false,
      });

      animationWindow.once('tauri://created', () => {
        setIsAnimationWindowOpen(true);
      });

      animationWindow.once('tauri://destroyed', () => {
        setIsAnimationWindowOpen(false);
      });
    } catch (error) {
      console.error('[SettingsPage] アニメーションウィンドウのオープンに失敗しました:', error);
      alert('アニメーションウィンドウを開けませんでした');
    }
  };

  const handleChangeWorkspace = async () => {
    try {
      setIsChangingWorkspace(true);
      const selected = await open({
        directory: true,
        multiple: false,
        title: '新しいワークスペースフォルダを選択'
      });

      if (selected && typeof selected === 'string') {
        // ワークスペースを切り替えるだけ
        // UIの更新はZustandストアとイベントリスナーが自動的に処理する
        await WorkspaceManager.getInstance().switchWorkspace(selected);
      }
    } catch (error) {
      console.error('ワークスペース変更エラー:', error);
      alert('フォルダの変更に失敗しました');
    } finally {
      setIsChangingWorkspace(false);
    }
  };

  return (
    <div className={styles.settingsPage}>
      <h1>初期設定</h1>

      {/* ステップ0: 動作モード選択 */}
      <section className={styles.section}>
        <h2>ステップ0: 動作モード</h2>
        <div>
          <label style={{ display: 'inline-flex', alignItems: 'center', marginRight: 16 }}>
            <input
              type="radio"
              name="operation-mode"
              value="auto"
              checked={operationMode === 'auto'}
              onChange={async () => {
                setOperationMode('auto');
                try { 
                  await AppSettingsService.saveAppSetting('operation_mode', 'auto'); 
                  emit('app-settings-changed', { key: 'operation_mode', value: 'auto' });
                } catch {}
              }}
            />
            <span style={{ marginLeft: 8 }}>Auto（推奨）</span>
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', marginRight: 16 }}>
            <input
              type="radio"
              name="operation-mode"
              value="relay"
              checked={operationMode === 'relay'}
              onChange={async () => {
                setOperationMode('relay');
                try { 
                  await AppSettingsService.saveAppSetting('operation_mode', 'relay'); 
                  emit('app-settings-changed', { key: 'operation_mode', value: 'relay' });
                } catch {}
              }}
            />
            <span style={{ marginLeft: 8 }}>オンライン（Relay）</span>
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center' }}>
            <input
              type="radio"
              name="operation-mode"
              value="local"
              checked={operationMode === 'local'}
              onChange={async () => {
                setOperationMode('local');
                try { 
                  await AppSettingsService.saveAppSetting('operation_mode', 'local'); 
                  emit('app-settings-changed', { key: 'operation_mode', value: 'local' });
                } catch {}
              }}
            />
            <span style={{ marginLeft: 8 }}>オフライン（Local）</span>
          </label>
        </div>
        <div className={styles.note}>
          <p>Auto: Relayを自動試行し不可時はLocalに案内。Relay: 4G/5Gのまま中継経由。Local: 会場Wi‑Fi/PCホットスポットでPCに直接接続。</p>
        </div>
      </section>

      {/* ライセンス */}
      <section className={styles.section}>
        <h2>ライセンス</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 12, alignItems: 'center', maxWidth: 760 }}>
          <div>状態</div>
          <div>
            {licenseStatus}
            {licenseExp ? (
              <span style={{ marginLeft: 8, color: '#555' }}>
                (期限: {new Date(licenseExp * 1000).toLocaleString()})
              </span>
            ) : null}
          </div>
          <div>ライセンスコード</div>
          <div>
            <input
              type="text"
              placeholder="XXXX-XXXX-..."
              value={licenseCode}
              onChange={(e) => setLicenseCode(e.target.value)}
              style={{ width: '100%', padding: 6, borderRadius: 6, border: '1px solid #ccc' }}
            />
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <button
                onClick={async () => {
                  const eff = GlobalSettingsService.getEffective() || await GlobalSettingsService.loadEffective();
                  const pid = (eff as any)?.relay?.pcId || pcId;
                  const code = licenseCode.trim();
                  if (!code) { alert('ライセンスコードを入力してください'); return; }
                  const res = await activateDevice({ licenseCode: code, pcId: pid });
                  if (res.ok) {
                    setLicenseStatus('有効化済み');
                    const tok = await loadDeviceToken();
                    if (tok) setLicenseExp(parseJwtExp(tok));
                    alert('有効化しました');
                  } else {
                    alert('有効化に失敗しました: ' + (res.error || 'unknown'));
                  }
                }}
                className={styles.animationButton}
              >有効化</button>
              <button
                onClick={async () => { await deleteDeviceToken(); setLicenseStatus('未有効化'); setLicenseExp(null); }}
                className={styles.animationButton}
                style={{ backgroundColor: '#999' }}
              >トークン削除</button>
            </div>
          </div>
        </div>
        <div className={styles.note}><p>有効化すると端末トークンがOSの安全な領域に保存されます（eventIdとは独立）。</p></div>
      </section>

      {/* Relay設定 */}
      <section className={styles.section}>
        <h2>Relay設定</h2>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>PCブリッジ状態: {pcBridgeStatus}</div>
        {!hideRelaySettings && (<>
        <div style={{ display: 'grid', gap: 12, maxWidth: 640 }}>
          <label>
            接続先
            <select
              value={relayEnv}
              onChange={async (e) => {
                const v = (e.target.value === 'stg' ? 'stg' : 'prod') as 'prod'|'stg';
                setRelayEnv(v);
                try {
                  await GlobalSettingsService.save('relay_env', v);
                  const chosen = v === 'stg' ? relayBaseUrlStg : relayBaseUrlProd;
                  await GlobalSettingsService.save('relay_base_url', chosen);
                  emit('app-settings-changed', { key: 'relay_env', value: v });
                } catch {}
              }}
            disabled={lockRelaySettings}>
              <option value="prod">本番</option>
              <option value="stg">検証（stg）</option>
            </select>
          </label>
          <label>
            本番ベースURL
            <input
              type="text"
              value={relayBaseUrlProd}
              onChange={async (e) => {
                const v = e.target.value;
                setRelayBaseUrlProd(v);
                try {
                  await GlobalSettingsService.save('relay_base_url_prod', v);
                  if (relayEnv === 'prod') await GlobalSettingsService.save('relay_base_url', v);
                emit('app-settings-changed', { key: 'relay_base_url_prod', value: v });
                } catch {}
              }}
              placeholder="https://ctrl.nuriemon.jp"
              style={{ width: '100%' }}
              disabled={lockRelaySettings}
            />
          </label>
          <label>
            検証(stg)ベースURL
            <input
              type="text"
              value={relayBaseUrlStg}
              onChange={async (e) => {
                const v = e.target.value;
                setRelayBaseUrlStg(v);
                try {
                  await GlobalSettingsService.save('relay_base_url_stg', v);
                  if (relayEnv === 'stg') await GlobalSettingsService.save('relay_base_url', v);
                  emit('app-settings-changed', { key: 'relay_base_url_stg', value: v });
                } catch {}
              }}
              placeholder="https://stg.ctrl.nuriemon.jp"
              style={{ width: '100%' }}
              disabled={lockRelaySettings}
            />
          </label>
          <label>
            Event ID
            <input
              type="text"
              value={relayEventId}
              onChange={async (e) => {
                const vRaw = e.target.value.trim().toLowerCase();
                const v = sanitizeId(vRaw);
                setRelayEventId(v);
                if (isValidId(v)) {
                  try {
                    await GlobalSettingsService.setUserEventId(v);
                    emit('app-settings-changed', { key: 'relay_event_id', value: v });
                  } catch {}
                }
              }}
              placeholder="例: demo"
              style={{ width: '100%' }}
              disabled={lockRelaySettings}
            />
          </label>
          <label>
            PC ID（任意、空なら自動）
            <input
              type="text"
              value={pcId}
              onChange={async (e) => {
            const vRaw = e.target.value.trim().toLowerCase();
            const v = sanitizeId(vRaw);
            setPcId(v);
            if (isValidId(v)) {
              try { 
                await GlobalSettingsService.save('pcid', v); 
                emit('app-settings-changed', { key: 'pcid', value: v });
              } catch {}
            }
              }}
              placeholder="例: booth-01"
              style={{ width: '100%' }}
            />
          </label>
          <fieldset style={{ border: '1px solid #eee', padding: 12, borderRadius: 6 }}>
            <legend>EVENT_SETUP_SECRET（安全保存）</legend>
            <div style={{ display: 'grid', gap: 8 }}>
              <div>
                <label>現在（保存済み）: <span style={{ fontFamily: 'monospace' }}>{storedSecretPreview || '(未設定)'}</span></label>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type={revealSecret ? 'text' : 'password'}
                  value={eventSetupSecretInput}
                  onChange={(e) => setEventSetupSecretInput(e.target.value)}
                  placeholder="イベント登録用シークレット（base64url推奨）"
                  style={{ width: '100%' }}
                  disabled={lockRelaySettings}
                />
                <button onClick={() => setRevealSecret(s => !s)}>{revealSecret ? 'Hide' : 'Reveal'}</button>
                <button onClick={async () => {
                  const envForSecret = await currentRelayEnvAsSecretEnv();
                  await setEventSetupSecret(envForSecret, eventSetupSecretInput.trim());
                  const s = await getEventSetupSecret(envForSecret);
                  setStoredSecretPreview(s ? maskSecret(s) : '');
                  setEventSetupSecretInput('');
                  setSecretFallback(isUsingMemoryFallback());
                  alert(isUsingMemoryFallback() ? '秘密鍵をメモリに保存しました（この環境では再起動で消えます）' : '秘密鍵を安全領域に保存しました');
                }}>Save</button>
                <button onClick={async () => {
                  if (await confirm('保存済みの秘密鍵を削除しますか？')) {
                    const envForSecret = await currentRelayEnvAsSecretEnv();
                    await deleteEventSetupSecret(envForSecret);
                    setStoredSecretPreview('');
                    setSecretFallback(isUsingMemoryFallback());
                  }
                }}>Delete</button>
              </div>
              <div className={styles.note}>
                <p>鍵はOSの安全領域に保存され、平文ファイルには保存されません。stg/prodで別々に管理されます。</p>
                {secretFallback && <p style={{ color: '#a60' }}>この環境では安全領域が利用できないため、メモリに一時保存します（再起動で消えます）。</p>}
              </div>
            </div>
          </fieldset>
        </div>
        <div className={styles.note}>
          <p>QRは `e` と `sid` のみを含み、WS用トークンはPOSTで取得します（URLにトークンは載せません）。</p>
          <p>EventID/PCIDの形式: 英小文字・数字・ハイフンのみ（3–32文字）。</p>
        </div>
        </>)}
        <div style={{ marginTop: 12 }}>
          <details>
            <summary>有効設定（effective）を表示</summary>
            <pre style={{ whiteSpace: 'pre-wrap', background: '#f6f8fa', padding: 8, borderRadius: 6, overflowX: 'auto' }}>{effectiveJson}</pre>
          </details>
          {lockRelaySettings && (
            <div className={styles.note}>
              <p>Relay設定はプロビジョニングでロックされています。変更できません。</p>
            </div>
          )}
        </div>
      </section>

      {/* ステップ1: ワークスペース */}
      <section className={styles.section}>
        <h2>ステップ1: 現在のワークスペース</h2>
        <div className={styles.workspaceInfo}>
          <p>現在の作業フォルダ:</p>
          <div className={styles.workspacePath}>
            {currentWorkspace || 'ワークスペースが選択されていません'}
          </div>
          <button 
            className={styles.changeWorkspaceButton}
            onClick={handleChangeWorkspace}
            disabled={isChangingWorkspace}
          >
            {isChangingWorkspace ? '変更中...' : 'フォルダを変更'}
          </button>
          <div className={styles.note}>
            <p>※ 作業フォルダを変更すると、そのフォルダに保存されているデータが読み込まれます。</p>
          </div>
        </div>
      </section>


      {/* ステップ2: 背景の設定 */}
      <section className={styles.section}>
        <h2>ステップ2: 背景の設定</h2>
        <div className={styles.backgroundUpload}>
          <div className={styles.uploadBox}>
            <div className={styles.uploadControls}>
              <button
                className={styles.fileInputLabel}
                onClick={handleBackgroundSelect}
                disabled={uploadingBackground}
              >
                {uploadingBackground ? 'アップロード中...' : '背景を選択'}
              </button>
            </div>
            
            {uploadingBackground && (
              <div className={styles.progressBarContainer}>
                <div className={styles.progressBar} style={{ width: `${backgroundProgress}%` }}>
                  <span className={styles.progressText}>{Math.round(backgroundProgress)}%</span>
                </div>
              </div>
            )}
            
            {backgroundUrl && (
              <div className={styles.currentBackground}>
                <h4>現在の背景</h4>
                <div className={styles.backgroundPreview}>
                  {backgroundType === 'video' ? (
                    <video 
                      src={backgroundUrl} 
                      className={styles.previewVideo}
                      autoPlay
                      loop
                      muted
                    />
                  ) : (
                    <img 
                      src={backgroundUrl} 
                      alt="現在の背景" 
                      className={styles.previewImage}
                    />
                  )}
                  <button 
                    className={styles.removeButton}
                    onClick={handleRemoveBackground}
                  >
                    背景を削除
                  </button>
                </div>
              </div>
            )}
          </div>
          
          <div className={styles.note}>
            <p>対応ファイル：jpg、png、mp4、mov（50MB以下）</p>
            <p>※アニメーションの背景に使用されます。</p>
          </div>
        </div>
      </section>

      {/* ステップ3: 地面の位置設定 */}
      <section className={styles.section}>
        <h2>ステップ3: 地面の位置設定</h2>
        <GroundSetting
          backgroundUrl={backgroundUrl || undefined}
          backgroundType={backgroundType}
          onGroundPositionChange={handleGroundPositionChange}
          groundPosition={groundPosition}
        />
        <div className={styles.note}>
          <p>赤線をドラッグして地面の位置を調整して下さい。(スマートフォンの場合はタップして下さい。)</p>
        </div>
      </section>

      {/* ステップ4: 音楽の設定 */}
      <section className={styles.section}>
        <h2>ステップ4: 音楽の設定</h2>
        <AudioSettings />
        <div className={styles.note}>
          <p>対応ファイル：mp3、mp4(BGM50MB・効果音1MB以下)</p>
          <p>※効果音は新規画像がスクリーンに登場した時に再生されます。</p>
        </div>
      </section>

      {/* ステップ5: 非表示までの時間設定 */}
      <section className={styles.section}>
        <h2>ステップ5: 非表示までの時間設定</h2>
        <select value={deletionTime} onChange={handleDeletionTimeChange}>
          <option value="unlimited">無制限</option>
          <option value="1">1分</option>
          <option value="2">2分</option>
          <option value="3">3分</option>
          <option value="4">4分</option>
          <option value="5">5分</option>
          <option value="6">6分</option>
          <option value="7">7分</option>
          <option value="8">8分</option>
          <option value="9">9分</option>
          <option value="10">10分</option>
          <option value="15">15分</option>
          <option value="20">20分</option>
          <option value="30">30分</option>
        </select>
        <div className={styles.note}>
          <p>アップロードされたお絵描きが表示されてから消えるまでの時間を設定できます。</p>
          <p>例：「1分」に設定すると、画像はアップロードから1分後にスクリーンから消えます。</p>
          <p>※「無制限」に設定すると、お絵描き一覧から削除するまでスクリーンに残り続けます。</p>
          <p>※設定を途中で変更する場合は、 <a href="/gallery">お絵描き一覧</a> からすべての画像を削除した後に変更してください。</p>
        </div>
      </section>

      {/* ステップ6: スクリーンを表示 */}
      <section className={styles.section}>
        <h2>ステップ6: スクリーンを表示</h2>
        <button 
          onClick={openAnimationWindow}
          disabled={isAnimationWindowOpen}
          className={styles.animationButton}
        >
          {isAnimationWindowOpen ? 'アニメーション表示中' : 'アニメーションを表示'}
        </button>
      </section>

      {/* データベースメンテナンス */}
      <section className={styles.section}>
        <h2>データベース管理</h2>
        <button 
          onClick={async () => {
            const confirmed = await confirm('データベースをクリーンアップしますか？\n\n重複ファイルや存在しないファイルへの参照が削除されます。');
            if (confirmed) {
              try {
                const { cleanupDatabase, removeDuplicateFiles } = await import('../services/cleanupDatabase');
                await removeDuplicateFiles();
                await cleanupDatabase();
                // Tauriのメッセージダイアログを使用
                const { message } = await import('@tauri-apps/plugin-dialog');
                await message('クリーンアップが完了しました。', { title: '完了' });
                await loadSettings();
              } catch (error) {
                console.error('クリーンアップエラー:', error);
                const { message } = await import('@tauri-apps/plugin-dialog');
                await message('クリーンアップ中にエラーが発生しました。', { title: 'エラー', kind: 'error' });
              }
            }
          }}
          className={styles.animationButton}
          style={{ backgroundColor: '#ff6b6b' }}
        >
          データベースをクリーンアップ
        </button>
        <div className={styles.note}>
          <p>※重複したファイルや存在しないファイルへの参照を削除します。</p>
          <p>※問題が発生した場合のみ実行してください。</p>
        </div>
        <div style={{ marginTop: 24 }}>
          <h3>アップデート</h3>
          <button onClick={() => checkForUpdatesManually()} className={styles.animationButton}>アップデートを確認</button>
          <div className={styles.note}><p>GitHub Releases を参照して更新を確認します（ネットワークが必要）。</p></div>
        </div>
      </section>
    </div>
  );
}

// ========= helpers =========
function maskSecret(s: string): string {
  const t = (s || '').toString();
  if (t.length <= 6) return '******';
  return `${t.slice(0, 3)}…${t.slice(-3)}`;
}
function sanitizeId(input: string): string {
  // 小文字英数とハイフンのみ、最大32
  return input.replace(/[^a-z0-9-]/g, '').slice(0, 32);
}

function isValidId(input: string): boolean {
  return /^[a-z0-9-]{3,32}$/.test(input);
}

function generateDefaultPcid(): string {
  // pc- + base32(6)
  const alphabet = '0123456789abcdefghjkmnpqrstvwxyz'; // 小文字/除外セット
  let s = '';
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `pc-${s}`;
}
