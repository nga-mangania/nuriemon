import { useEffect, useRef, useState } from 'react';
import { emit } from '@tauri-apps/api/event';
import styles from './ControllerSettings.module.scss';
import {
  DEFAULT_CONTROLLER_SETTINGS,
  ControllerSettings,
  loadControllerSettings,
  saveControllerSettings,
} from '../services/controllerSettings';

export function ControllerSettings() {
  const [settings, setSettings] = useState<ControllerSettings>(DEFAULT_CONTROLLER_SETTINGS);
  const [isSaving, setIsSaving] = useState(false);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;
    loadControllerSettings().then((loaded) => {
      if (mounted) setSettings(loaded);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, []);

  const updateSetting = (partial: Partial<ControllerSettings>) => {
    const next = { ...settings, ...partial };
    setSettings(next);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      setIsSaving(true);
      await saveControllerSettings(next);
      await emit('app-settings-changed', { key: 'controller_settings', value: JSON.stringify(next) });
      setIsSaving(false);
    }, 200);
  };

  const speedPercent = Math.round(settings.manualSpeedFactor * 100);

  return (
    <div className={styles.controllerSettings}>
      <section className={styles.card}>
        <div className={styles.header}>
          <h2 className={styles.title}>移動速度</h2>
          {isSaving && <span className={styles.description}>保存中...</span>}
        </div>
        <p className={styles.description}>
          コントローラーでキャラクターを移動するときの速度を調整できます。
          標準の 70% から 130% の範囲で設定可能です。
        </p>
        <div className={styles.sliderRow}>
          <label htmlFor="manual-speed">移動速度 ({speedPercent}%)</label>
          <input
            id="manual-speed"
            type="range"
            min={30}
            max={130}
            step={5}
            value={speedPercent}
            onChange={(e) => updateSetting({ manualSpeedFactor: Number(e.target.value) / 100 })}
          />
          <p className={styles.valueNote}>
            デフォルトは 70%。数値が低いほどゆっくり、高いほど速く移動します。
          </p>
        </div>
      </section>

      <section className={styles.futureNote}>
        <strong>今後の予定:</strong>
        <p>
          この画面では将来的にボタン割り当てやアクションのカスタマイズも行えるようにする予定です。
        </p>
      </section>
    </div>
  );
}
