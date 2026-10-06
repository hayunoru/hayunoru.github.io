#!/usr/bin/env node
// 見本データ（ダミー）で見た目確認用の HTML を作る。合言葉は「demo」。
//   npm run demo      examples/*.yaml と vault.example.yaml → demo/*.html
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ConfigError } from './lib/config.mjs';
import { createKeys, loadConfig, produce } from './lib/vault.mjs';

const PASS = 'demo';
const sources = [['vault.example.yaml', 'index']];
for (const f of readdirSync('examples').sort()) {
  if (f.endsWith('.yaml')) sources.push([path.join('examples', f), path.basename(f, '.yaml')]);
}

mkdirSync('demo', { recursive: true });
try {
  for (const [file, name] of sources) {
    const { text, cfg } = loadConfig(file);
    const keys = await createKeys(cfg.kdf, PASS);
    const { html } = await produce({ cfg, configText: text, keys });
    const out = path.join('demo', name + '.html');
    writeFileSync(out, html);
    process.stderr.write(`✔ ${out}（${file}）\n`);
  }
  process.stderr.write('合言葉は demo です。\n');
} catch (e) {
  process.stderr.write((e instanceof ConfigError ? e.message : '✖ ' + e.message) + '\n');
  process.exit(1);
}
