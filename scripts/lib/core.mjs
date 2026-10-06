// ブラウザと同じ src/core.js を Node で読み込む
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);

if (!globalThis.hashwasm) {
  globalThis.hashwasm = require('hash-wasm');
}
if (!globalThis.HJGCore) {
  const src = readFileSync(new URL('../../src/core.js', import.meta.url), 'utf8');
  vm.runInThisContext(src, { filename: 'src/core.js' });
}

export const core = globalThis.HJGCore;
