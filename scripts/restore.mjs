#!/usr/bin/env node
// 公開中の HTML から設定ファイル（平文）を取り戻す。全部失くした後の編集用。
//   npm run restore                     docs/index.html → vault.yaml
//   オプション: --from <html> --out <file> --force（上書き）
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { core } from './lib/core.mjs';
import { readSecret } from './lib/prompt.mjs';
import { extractVault } from './lib/render.mjs';

const { values: opt } = parseArgs({
  options: {
    from: { type: 'string', default: 'docs/index.html' },
    out: { type: 'string', default: 'vault.yaml' },
    force: { type: 'boolean', default: false }
  }
});

const log = (s = '') => process.stderr.write(s + '\n');

async function main() {
  if (!existsSync(opt.from)) throw new Error(`${opt.from} がありません。`);
  if (existsSync(opt.out) && !opt.force) throw new Error(`${opt.out} がすでにあります。上書きするなら --force を付けてください。`);
  const vault = extractVault(readFileSync(opt.from, 'utf8'));
  if (!vault) throw new Error(`${opt.from} に暗号データが見つかりません。`);
  const pass = await readSecret('合言葉: ');
  log('鍵を導出しています…');
  const res = await core.unlock(vault, pass);
  if (!res) throw new Error('合言葉が違います。');
  writeFileSync(opt.out, res.payload.yaml, { mode: 0o600 });
  chmodSync(opt.out, 0o600); // 上書き時も自分だけが読めるように
  log(`✔ ${opt.out} に書き出しました。編集したら npm run build。`);
}

main().catch((e) => {
  log('✖ ' + (e && e.message ? e.message : e));
  process.exit(1);
});
