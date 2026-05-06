# Codex RemoteControl WebApp

Codex CLI をブラウザUIから操作するためのローカル向け Web アプリです。React + Vite のクライアントと、Fastify ベースのサーバーで構成されています。

## 主な機能

- セッション一覧の作成、更新、アーカイブ、完全削除
- Codex 実行中の進捗、承認要求、出力、WebSocket によるリアルタイム更新
- 作業ディレクトリの選択と、セッション配下ファイルのプレビュー
- 添付ファイルアップロード
- Git 状態の確認、コミット作成、Codex review 実行
- Codex 使用量の取得

## 技術構成

- Frontend: React 19, TypeScript, Vite, Tailwind CSS
- Backend: Fastify, TypeScript, WebSocket
- Runtime: Node.js, Codex CLI

## 動作要件

- Node.js 20 以上を推奨
- npm
- Codex CLI

Codex CLI の実行パスはデフォルトで `/opt/homebrew/bin/codex` を参照します。別の場所にある場合は `CODEX_BIN` 環境変数で指定してください。

## セットアップ

```bash
npm install
npm run dev
```

起動後のデフォルトURL:

- Frontend: `http://127.0.0.1:5173`
- Backend API: `http://127.0.0.1:3001`

## 使い方

1. ブラウザで `http://127.0.0.1:5173` を開きます。
2. 新規セッションを作成し、タイトルと作業フォルダを設定します。
3. 必要に応じてモデル、推論強度、sandbox、承認ポリシーを調整します。
4. チャット欄にプロンプトを入力して Codex を実行します。
5. 実行中は進捗、コマンド実行、承認待ち状態を画面上で確認します。
6. 承認が必要なコマンドは、画面から許可、セッション中だけ許可、拒否、中断を選べます。
7. ファイルタブでは、作業フォルダ配下のファイル一覧とプレビューを確認できます。
8. 添付が必要な場合はファイルをアップロードして、プロンプトと一緒に渡せます。
9. Git タブでは変更差分の確認とコミット作成ができます。
10. Review タブでは `codex review --uncommitted` 相当のレビューを実行できます。

## 典型的な流れ

1. 作業フォルダを指定したセッションを作る
2. チャットで修正依頼や実装依頼を送る
3. 必要な承認に対応する
4. 生成・変更されたファイルをプレビューや Git タブで確認する
5. Review を実行して問題がないかを見る
6. 問題なければコミットする

## 利用できるスクリプト

```bash
npm run dev
npm run build
npm run check
npm run test:api
```

`npm run test:api` はバックエンド起動後に実行してください。

## ディレクトリ構成

```text
.
├─ client/   # React + Vite frontend
├─ server/   # Fastify backend
├─ scripts/  # smoke test scripts
└─ data/     # runtime-generated data (git ignore)
```

## セキュリティ上の注意

- このリポジトリは公開用に、ローカルDB、アップロード、Playwright ログ、開発用メモを除外しています。
- 現在のサーバー実装はローカル利用前提です。認証は未実装のため、インターネットに直接公開しないでください。
- セッションで扱う作業ディレクトリやファイル内容には機微情報を含めない運用を推奨します。
