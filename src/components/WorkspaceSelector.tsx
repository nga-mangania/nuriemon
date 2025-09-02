import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useWorkspace } from '../hooks/useWorkspace';
import styles from './WorkspaceSelector.module.scss';

export function WorkspaceSelector() {
  const { error, switchWorkspace } = useWorkspace();
  const [isSelecting, setIsSelecting] = useState(false);

  const handleSelectWorkspace = async () => {
    try {
      setIsSelecting(true);

      const selected = await open({
        directory: true,
        multiple: false,
        title: 'ワークスペースフォルダを選択'
      });

      if (selected && typeof selected === 'string') {
        await switchWorkspace(selected);
      }
    } catch (error) {
      console.error('ワークスペース選択エラー:', error);
    } finally {
      setIsSelecting(false);
    }
  };

  return (
    <div className={styles.workspaceSelector}>
      <div className={styles.welcome}>
        <div className={styles.logoBox}>
          <img src="/welcome/nuriemon.png" alt="ぬりえもん ロゴ" className={styles.logoMain} />
          <img src="/welcome/nuriemon_c.png" alt="ぬりえもん ロゴ カラー" className={styles.logoSub} />
        </div>
        <h1>ようこそ！</h1>
        <p>まず、背景やBGM、スキャンした切り抜き作品を保存する<br />フォルダを選択してください。</p>
        <button
          className={styles.selectButton}
          onClick={handleSelectWorkspace}
          disabled={isSelecting}
        >
          {isSelecting ? '選択中...' : 'フォルダを選択'}
        </button>
        <p>※あとから変更も可能です。</p>
        {error && (
          <div className={styles.error}>{error}</div>
        )}
      </div>
    </div>
  );
}
