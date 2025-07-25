import { useEffect } from "react";
import AnimationPageSimple from "../components/AnimationPageSimple";
import { useWorkspace } from "../hooks/useWorkspace";
import "../styles/reset.scss";
import styles from "./AnimationWindow.module.scss";

// 初期ローディング画面を非表示にする（App.tsxと同じ）
function hideInitialLoading() {
  const loadingElement = document.getElementById('initial-loading');
  if (loadingElement) {
    loadingElement.classList.add('hidden');
    // アニメーション完了後に完全に削除
    setTimeout(() => {
      loadingElement.style.display = 'none';
    }, 300);
  }
}

function AnimationWindow() {
  const { isLoading, needsWorkspace, isReady } = useWorkspace();

  // 状態に基づいて初期ローディング画面を制御
  useEffect(() => {
    // 初期化が完了したら必ず初期ローディング画面を非表示
    if (!isLoading) {
      // 即座に非表示にする（遅延を最小限に）
      requestAnimationFrame(() => {
        hideInitialLoading();
      });
    }
  }, [isLoading]);

  // 初期化中は何も表示しない（HTMLのローディング画面が表示される）
  if (isLoading) {
    return null;
  }

  // ワークスペースが必要な場合（通常はアニメーションウィンドウでは発生しないはず）
  if (needsWorkspace) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          ワークスペースが設定されていません。
          メインウィンドウでワークスペースを選択してください。
        </div>
      </div>
    );
  }

  // 準備完了したらアニメーションページを表示
  if (isReady) {
    return (
      <div className={styles.container}>
        <AnimationPageSimple />
      </div>
    );
  }

  // フォールバック（通常は到達しない）
  return null;
}

export default AnimationWindow;