# AGENTS.md — AI エージェント（Codex / Claude など）向けの作業ルール

このリポジトリは「全部の端末を失くした時のための、暗号化された単体 HTML の復旧ページ」を作る。
公開リポジトリに置き、GitHub Pages で `docs/index.html` を配信する前提。

## 絶対に守ること

1. **`vault.yaml`（と `vault.*.yaml`、`*.restored.yaml`）を開かない・表示しない・内容を出力しない・コミットしない。**
   中身はパスワードや TOTP シードの平文。見本が必要なら `vault.example.yaml` と `examples/*.yaml`（ダミー）を使う。
   例外は `vault.example.yaml` だけ。
2. **合言葉が要るコマンドは実行しない。** `npm run build` / `npm run rekey` / `npm run restore` は人間が手元で実行する。
3. **暗号データの形式を勝手に変えない。** `src/core.js` の形式（`hijouguchi-vault` v1）を変えるときは、
   バージョンを上げ、古い形式も開けるようにし、テストを追加する。公開済みのページが開けなくなると取り返しがつかない。
4. **実行時に外部へ通信するコードを足さない。** ページは単体 HTML で、CSP で通信を禁止している（Google Fonts だけ設定で許可）。
   CDN の読み込み、解析タグ、外部 API は禁止。
5. 平文を `console.log` したり、ファイルに書き出したりする処理を足さない（`restore` を除く）。
6. **頼まれていない機能や要件を足さない。** シンプルで堅牢なことを優先する。思いついた改善は提案に留める。

## 構成

| パス | 役割 |
|---|---|
| `src/core.js` | 暗号（Argon2id + AES-256-GCM、鍵スロット）と TOTP。**ブラウザと Node で共通** |
| `src/app.js` | 画面。設定から章とブロックを描画する。個人情報は書かない |
| `src/style.css` | HUD テーマ。色は `--accent` / `--warn`（設定の `site.theme`）で変わる |
| `src/template.html` | 単体 HTML の雛形。`__TOKEN__` をビルド時に置き換える |
| `scripts/build.mjs` | `vault.yaml` → `docs/index.html` |
| `scripts/restore.mjs` | `docs/index.html` → `vault.yaml`（全部失くした後の編集用） |
| `scripts/demo.mjs` | 見本（ダミー）→ `demo/*.html`。合言葉は `demo` |
| `scripts/lib/config.mjs` | 設定ファイルの検証と正規化（スキーマはここが正） |
| `vault.example.yaml` | 設定ファイルの見本とコメントによる説明 |
| `examples/many.yaml` / `few.yaml` | 見た目確認用（項目が多い / 少ない） |
| `test/` | `npm test` |

## 作業の流れ

- 見た目や機能を変えたら `npm run demo` で `demo/*.html` を作り直し、ブラウザで開いて確認する（合言葉 `demo`）。
  PC 幅とスマホ幅（390px 前後）の両方、`demo/many.html` と `demo/few.html` の両方を見る。
- 変更したら必ず `npm test` を通す。
- 設定ファイルの項目を増やしたら、`scripts/lib/config.mjs`（検証）・`src/app.js`（描画）・`vault.example.yaml`（説明。設定の書き方の正はここ）をそろえて直す。README は最小限に保つ。
- 画面の文言は設定の `site.labels` で変えられるようにする。直書きしない。

## デザインの方針

- 意味のない装飾文字（それっぽい型番、架空のコードなど）を置かない。表示する文字はすべて本当のことにする。
- 日本語と英語で同じ内容を並べて書かない。
- 説明書き（「暗号化されています」など）をロック画面に出さない。技術情報は短いチップ（CIPHER / KDF / UPDATED）だけ。
- 状態表示は上端の同じ位置（○ LOCKED / ● UNLOCKED）。
- 章の背景の分け方は `site.ui.sectionStyle`（meaning / tone / module / index / none）。どれも新しい色や模様を持ち込まず、
  今の線と光の文法の中で分ける。章や中身の配置を自動で変えることはしない（設定に書いた順番どおり）。
- 今いる章の表示はスマホ幅だけ（タブの列を上に貼り付ける）。PC では何もしない。
