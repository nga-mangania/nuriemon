/**
 * ディレクトリへのアクセス権限を追加
 */
export async function addDirectoryScope(directory: string): Promise<void> {
  try {
    // Tauri v2では、fs pluginのスコープはRust側で管理される
    // 現在のところ、動的なスコープ追加はプラグインAPIを通じて行う必要がある
    // ここでは、ディレクトリ選択ダイアログで選択されたパスは自動的にスコープに追加される
    
    // 追加の権限設定が必要な場合は、Rust側でカスタムコマンドを実装する必要がある
  } catch (error) {
    console.error('addDirectoryScope: エラー', error);
    throw error;
  }
}

/**
 * ファイルパスを正規化
 */
export function normalizePath(path: string): string {
  // Windowsのバックスラッシュをスラッシュに変換
  return path.replace(/\\/g, '/');
}