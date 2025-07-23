import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useWorkspace } from '../hooks/useWorkspace';
import styles from './WorkspaceSelector.module.scss';

export function WorkspaceSelector() {
  const { currentWorkspace, isLoading, error, switchWorkspace } = useWorkspace();
  const [progress, setProgress] = useState<string | null>(null);

  const handleSelectWorkspace = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'ワークスペースフォルダを選択'
      });

      if (selected && typeof selected === 'string') {
        setProgress('ワークスペースを準備しています...');
        await switchWorkspace(selected, (message) => {
          setProgress(message);
        });
        setProgress(null);
      }
    } catch (error) {
      console.error('ワークスペース選択エラー:', error);
      setProgress(null);
    }
  };

  if (!currentWorkspace && !isLoading) {
    return (
      <div className={styles.workspaceSelector}>
        <div className={styles.welcome}>
          <h1>ぬりえもんへようこそ！</h1>
          <p>まず、作品を保存するフォルダを選択してください。</p>
          <button 
            className={styles.selectButton}
            onClick={handleSelectWorkspace}
          >
            フォルダを選択
          </button>
          {error && (
            <div className={styles.error}>{error}</div>
          )}
        </div>
      </div>
    );
  }

  if (isLoading || progress) {
    return (
      <div className={styles.workspaceSelector}>
        <div className={styles.loading}>
          <p>{progress || 'ワークスペースを読み込んでいます...'}</p>
        </div>
      </div>
    );
  }

  return null;
}