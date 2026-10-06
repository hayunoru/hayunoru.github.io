#!/usr/bin/env node
// 使い方:
//   npm run build                 vault.yaml → docs/index.html（いつもの更新）
//   npm run build -- --rekey      合言葉を決め直す（新しい鍵で作り直す）
//   オプション: --config <file> --out <file>
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ConfigError } from './lib/config.mjs';
import { readNewSecret, readSecret } from './lib/prompt.mjs';
import { assertNotTracked, createKeys, loadConfig, produce, readExistingVault, reuseKeys, sameKdf } from './lib/vault.mjs';

const { values: opt } = parseArgs({
  options: {
    config: { type: 'string', default: 'vault.yaml' },
    out: { type: 'string', default: 'docs/index.html' },
    rekey: { type: 'boolean', default: false }
  }
});

const log = (s = '') => process.stderr.write(s + '\n');

async function main() {
  const { text, cfg } = loadConfig(opt.config);
  assertNotTracked(opt.config);

  const existing = opt.rekey ? null : readExistingVault(opt.out);

  let keys;
  if (!existing) {
    log(opt.rekey ? '新しい鍵で作り直します。' : `${opt.out} がないので、新しく鍵を作ります。`);
    log('合言葉はランダムに作った長いもの（英数字 15 文字以上 / 単語 6〜7 個など）を使ってください。');
    const pass = await readNewSecret('新しい合言葉');
    log('鍵を導出しています…');
    keys = await createKeys(cfg.kdf, pass);
  } else {
    const pass = await readSecret('合言葉: ');
    log('鍵を導出しています…');
    keys = await reuseKeys(existing, pass);
    if (!keys) throw new Error('合言葉が違います。（合言葉ごと作り直す場合は --rekey）');
    if (!sameKdf(existing.slots[0].kdf, cfg.kdf)) {
      log('※ kdf の設定が変わっていますが、既存の鍵には反映されません。反映するには --rekey で作り直してください。');
    }
  }

  const { html } = await produce({ cfg, configText: text, keys });
  mkdirSync(path.dirname(opt.out), { recursive: true });
  writeFileSync(opt.out, html);

  log('');
  log(`✔ ${opt.out} を書き出しました（${(html.length / 1024).toFixed(0)} KB、章 ${cfg.data.sections.length}）`);
  log('');
  log('次: git add docs && git commit && git push');
}

main().catch((e) => {
  log('');
  log(e instanceof ConfigError ? e.message : '✖ ' + (e && e.message ? e.message : e));
  process.exit(1);
});
