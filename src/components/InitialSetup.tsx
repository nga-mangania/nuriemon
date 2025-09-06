import React, { useEffect, useState } from 'react';
import { emit } from '@tauri-apps/api/event';
import { GlobalSettingsService } from '../services/globalSettings';

function sanitizeId(input: string): string {
  return input.replace(/[^a-z0-9-]/g, '').slice(0, 32);
}
function isValidId(input: string): boolean {
  return /^[a-z0-9-]{3,32}$/.test(input);
}

export const InitialSetup: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const [eid, setEid] = useState('');
  const [error, setError] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setError(''); }, [eid]);

  const save = async () => {
    const v = sanitizeId(eid.trim().toLowerCase());
    if (!isValidId(v)) {
      setError('英小文字・数字・ハイフンの3〜32文字で入力してください');
      return;
    }
    try {
      setSaving(true);
      await GlobalSettingsService.setUserEventId(v);
      emit('app-settings-changed', { key: 'relay_event_id', value: v });
      onDone();
    } catch (e) {
      setError('保存に失敗しました。もう一度お試しください。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
    }}>
      <div style={{ background: '#fff', padding: 24, borderRadius: 12, width: 520, boxShadow: '0 8px 30px rgba(0,0,0,0.2)' }}>
        <h2 style={{ marginTop: 0 }}>初回セットアップ</h2>
        <p style={{ color: '#444' }}>イベントIDを入力してください（購入時の案内どおり）。</p>
        <label style={{ display: 'block', marginTop: 12 }}>Event ID</label>
        <input
          autoFocus
          type="text"
          value={eid}
          onChange={(e) => setEid(e.target.value)}
          placeholder="例: school-2025-autumn"
          style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #ccc' }}
        />
        {error && <div style={{ color: '#c00', marginTop: 8 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onDone} disabled={saving}>あとで</button>
          <button onClick={save} disabled={saving} style={{ background: '#2f74c0', color: '#fff', padding: '6px 12px', borderRadius: 6 }}>{saving ? '保存中…' : '保存'}</button>
        </div>
        <div style={{ marginTop: 10, color: '#666', fontSize: 12 }}>この設定は端末全体の設定として保存され、ワークスペースを切り替えても維持されます。</div>
      </div>
    </div>
  );
};

