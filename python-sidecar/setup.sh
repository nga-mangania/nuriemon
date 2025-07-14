#!/bin/bash

echo "Python環境をセットアップしています..."

# 仮想環境を作成
python3 -m venv venv

# 仮想環境を有効化
source venv/bin/activate

# 依存関係をインストール
pip install --upgrade pip
pip install -r requirements.txt

echo "セットアップが完了しました！"
echo "使用方法: source venv/bin/activate"