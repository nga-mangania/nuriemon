import React from 'react';
import { movementNames, sizeNames, typeNames } from '../services/animationSettings';
import styles from './MovementSettings.module.scss';

interface MovementSettingsProps {
  settings: {
    type: 'walk' | 'fly';
    movement: string;
    size: string;
    speed: number;
  };
  onSettingsChange: (settings: Partial<MovementSettingsProps['settings']>) => void;
}

const movements = Object.entries(movementNames).map(([value, name]) => ({
  name,
  value,
}));

const sizes = Object.entries(sizeNames).map(([value, name]) => ({
  name,
  value,
}));

const types = Object.entries(typeNames).map(([value, name]) => ({
  name,
  value,
}));

const MovementSettings: React.FC<MovementSettingsProps> = ({ settings, onSettingsChange }) => {
  const handleChange = (key: keyof MovementSettingsProps['settings'], value: string | number) => {
    if (key === 'speed') {
      onSettingsChange({ [key]: parseFloat(value as string) });
    } else {
      onSettingsChange({ [key]: value });
    }
  };

  const handleSpeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const speed = parseFloat(e.target.value);
    onSettingsChange({ speed: isNaN(speed) ? 0.5 : speed });
  };

  const handleRandomSettings = () => {
    const randomMovement = movements[Math.floor(Math.random() * movements.length)].value;
    const randomSize = sizes[Math.floor(Math.random() * sizes.length)].value;
    const randomSpeed = Math.random();
    const randomType = types[Math.floor(Math.random() * types.length)].value as 'walk' | 'fly';
    onSettingsChange({
      movement: randomMovement,
      size: randomSize,
      speed: randomSpeed,
      type: randomType,
    });
  };

  const formatSpeed = (speed: number | undefined): string => {
    if (speed === undefined || speed === null) {
      return "50%";
    }
    return `${Math.max(0, Math.min(100, Math.round(speed * 100)))}%`;
  };

  return (
    <div className={styles.settingsContainer}>
      <h3>動きの設定</h3>
      <button className={styles.randomButton} onClick={handleRandomSettings}>
        ランダム選択
      </button>
      <div className={styles.settingGroup}>
        <label htmlFor="type">動きのタイプ：</label>
        <select
          id="type"
          value={settings.type}
          onChange={(e) => handleChange("type", e.target.value)}
        >
          {types.map((t) => (
            <option key={t.value} value={t.value}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.settingGroup}>
        <label htmlFor="movement">動きのパターン：</label>
        <select
          id="movement"
          value={settings.movement}
          onChange={(e) => handleChange("movement", e.target.value)}
        >
          {movements.map((m) => (
            <option key={m.value} value={m.value}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.settingGroup}>
        <label htmlFor="size">パターンの大きさ：</label>
        <select
          id="size"
          value={settings.size}
          onChange={(e) => handleChange("size", e.target.value)}
        >
          {sizes.map((s) => (
            <option key={s.value} value={s.value}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.settingGroup}>
        <label htmlFor="speed">
          画面を動く速さ：{formatSpeed(settings.speed)}
        </label>
        <div className={styles.speedSliderContainer}>
          <input
            type="range"
            id="speed"
            min="0"
            max="1"
            step="0.1"
            value={settings.speed !== undefined ? settings.speed : 0.5}
            onChange={handleSpeedChange}
            className={styles.speedSlider}
          />
        </div>
        <div className={styles.speedLabels}>
          <span>おそい</span>
          <span>ふつう</span>
          <span>はやい</span>
        </div>
      </div>
    </div>
  );
};

export default MovementSettings;
export { MovementSettings };