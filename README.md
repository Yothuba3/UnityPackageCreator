# Unity Package Creator

Unity パッケージ用の `package.json` と UPM インストール手順付き `README.md` をインタラクティブに生成する CLI ツールです。

- 4 ステップの対話形式ウィザード（name / version / displayName / description）
- 命名規則・セマンティックバージョニングのバリデーション
- Git リポジトリを自動検出し、`origin` から UPM Git URL を生成
- 保存前にプレビュー＆確認

## 必要環境

- Node.js 18 以上

## インストール & 使い方

### 方法 1: npx で直接実行（インストール不要）

Unity パッケージを作りたいディレクトリで:

```bash
npx github:Yothuba3/UnityPackageCreator
```

### 方法 2: グローバルインストール

```bash
git clone https://github.com/Yothuba3/UnityPackageCreator.git
cd UnityPackageCreator
npm install -g .
```

以後、任意のディレクトリで以下のコマンドを実行できます:

```bash
create-unity-package
```

### 出力先ディレクトリを指定する

```bash
create-unity-package ./path/to/package
```

## 生成されるファイル

- `package.json` — Unity Package Manager 用のマニフェスト
- `README.md` — UPM Git URL を使ったインストール手順入り（Git リポジトリ内で実行した場合）

## ライセンス

MIT
