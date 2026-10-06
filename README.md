# 非常口

全部の端末を失くした時のための、暗号化された単体 HTML の復旧ページ。

連絡先・バックアップコード・TOTP・パスワード類を `vault.yaml` に書き、`npm run build` で
暗号化した `docs/index.html` を作って GitHub Pages で公開する。どこかの端末でページを開き、合言葉を入れると読める。

- 暗号は Argon2id + AES-256-GCM。復号はブラウザ内だけで行う
- 平文の `vault.yaml` は git に入らない（`.gitignore`・ビルド時の確認・pre-commit フック）
- 見本: `demo/index.html` / `many.html` / `few.html`（合言葉 `demo`）

## はじめかた

Node.js 20 以上と git が必要。

```sh
# GitHub の「Use this template」で自分のリポジトリを作ってから
git clone https://github.com/<you>/<repo>.git && cd <repo>
npm ci              # 平文コミット防止のフックも有効になる
npm run init        # vault.example.yaml → vault.yaml
# vault.yaml を編集（書き方は vault.example.yaml のコメント）
npm run build       # 初回は合言葉を決める
git add docs && git commit -m "update" && git push
```

GitHub の Settings → Pages で、`main` ブランチの `/docs` を公開する。

合言葉はランダムに生成した長いもの（英数字 15 文字以上など）にする。

## 使い方

| やること | コマンド |
|---|---|
| 更新 | `vault.yaml` を編集 → `npm run build` → `git add docs` してコミット・push |
| 合言葉を変える | `npm run rekey`（`kdf:` の変更もこのとき反映される） |
| 全部失くした後に編集する | clone → `npm ci` → `npm run restore`（`docs/index.html` から `vault.yaml` を取り戻す） |
| 見た目の確認 | `npm run demo` → `demo/*.html` |
| テスト | `npm test` |

## 注意

- 暗号文は git の履歴やフォークに永久に残る。強さは合言葉で決まる
- 合言葉を変えても、古いページは古い合言葉で開ける。漏洩を疑うときは中身のパスワードやコードも変える
- 借りた端末で開いた後は、合言葉を変える
- `site:` の欄はロック画面に平文で出る。個人情報は書かない
- Google Fonts を使う設定（既定）では、ページを開いたことが Google に伝わる（中身は伝わらない）。`site.ui.googleFonts: false` で通信ゼロになる

AI エージェント（Codex / Claude Code）向けのルールは `AGENTS.md`。

同梱の [hash-wasm](https://github.com/Daninet/hash-wasm)（Argon2id）は MIT License。
