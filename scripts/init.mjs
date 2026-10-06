#!/usr/bin/env node
// vault.example.yaml をコピーして、自分用の vault.yaml（git の対象外）を作る
import { copyFileSync, existsSync } from 'node:fs';

const src = 'vault.example.yaml';
const dst = 'vault.yaml';

if (existsSync(dst)) {
  process.stderr.write(`${dst} はすでにあります。そのまま編集してください。\n`);
} else {
  copyFileSync(src, dst);
  process.stderr.write(`✔ ${dst} を作りました（git には入りません）。編集したら npm run build。\n`);
}
