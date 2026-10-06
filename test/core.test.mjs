import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { core } from '../scripts/lib/core.mjs';
import { ConfigError, parseConfig } from '../scripts/lib/config.mjs';
import { extractVault } from '../scripts/lib/render.mjs';
import { createKeys, produce, reuseKeys } from '../scripts/lib/vault.mjs';

// テストでは鍵導出を軽くする（本番は設定ファイルの kdf）
const FAST = { alg: 'argon2id', m: 1024, t: 1, p: 1 };
const enc = new TextEncoder();

test('TOTP: RFC 6238 のテストベクタと一致する', async () => {
  const seeds = {
    SHA1: enc.encode('12345678901234567890'),
    SHA256: enc.encode('12345678901234567890123456789012'),
    SHA512: enc.encode('1234567890123456789012345678901234567890123456789012345678901234')
  };
  const vectors = [
    [59, '94287082', '46119246', '90693936'],
    [1111111109, '07081804', '68084774', '25091201'],
    [1111111111, '14050471', '67062674', '99943326'],
    [1234567890, '89005924', '91819424', '93441116'],
    [2000000000, '69279037', '90698825', '38618901'],
    [20000000000, '65353130', '77737706', '47863826']
  ];
  for (const [t, s1, s256, s512] of vectors) {
    assert.equal(await core.totp(seeds.SHA1, { digits: 8, algorithm: 'SHA1' }, t * 1000), s1);
    assert.equal(await core.totp(seeds.SHA256, { digits: 8, algorithm: 'SHA256' }, t * 1000), s256);
    assert.equal(await core.totp(seeds.SHA512, { digits: 8, algorithm: 'SHA512' }, t * 1000), s512);
  }
});

test('base32 を正しく読む（空白・小文字・= を許す）', () => {
  const bytes = core.base32Decode('jbsw y3dp ehpk 3pxp');
  assert.deepEqual([...bytes], [0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x21, 0xde, 0xad, 0xbe, 0xef]);
  assert.deepEqual([...core.base32Decode('MZXW6===')], [...enc.encode('foo')]);
  assert.throws(() => core.base32Decode('ABC1'));
});

test('暗号化して、正しい合言葉でだけ開ける', async () => {
  const dek = core.newDek();
  const slots = [await core.makeSlot('correct horse battery staple', dek, FAST)];
  const vault = await core.seal(dek, slots, { hello: '世界', n: 1 });
  const ok = await core.unlock(vault, 'correct horse battery staple');
  assert.deepEqual(ok.payload, { hello: '世界', n: 1 });
  assert.equal(await core.unlock(vault, 'correct horse battery stapl'), null);
  // 中身を 1 バイト書き換えると開けない
  const broken = { ...vault, data: core.b64(core.unb64(vault.data).map((b, i) => (i === 3 ? b ^ 1 : b))) };
  await assert.rejects(core.openWithDek(broken, dek));
});

test('合言葉の Unicode 正規化（NFC）を揃える', async () => {
  const dek = core.newDek();
  const slots = [await core.makeSlot('がぎぐ', dek, FAST)];
  const vault = await core.seal(dek, slots, { x: 1 });
  assert.ok(await core.unlock(vault, 'がぎぐ'.normalize('NFD')));
});

test('設定：値は文字列のまま（先頭の 0 が消えない）', () => {
  const { data } = parseConfig(`
sections:
  - id: a
    title: A
    blocks:
      - entries:
          - name: X
            fields:
              - { label: PIN, value: 0012, secret: true }
              - { label: 電話, value: 090-0000-0000, type: tel }
`);
  const f = data.sections[0].blocks[0].items[0].fields;
  assert.equal(f[0].value, '0012');
  assert.equal(f[0].secret, true);
  assert.equal(f[1].type, 'tel');
});

test('設定：間違いはまとめて分かりやすく報告する', () => {
  try {
    parseConfig(`
sections:
  - id: Bad Id
    title: A
    blocks:
      - type: nope
  - id: b
    title: B
    blocks:
      - steps: ["[x](#missing)"]
      - totp: [{ name: X, secret: "not!base32" }]
`);
    assert.fail('例外になるはず');
  } catch (e) {
    assert.ok(e instanceof ConfigError);
    const msg = e.message;
    assert.match(msg, /sections\[0\]\.id/);
    assert.match(msg, /知らない種類/);
    assert.match(msg, /#missing/);
    assert.match(msg, /base32/);
  }
});

test('設定：otpauth URI を読める', () => {
  const { data } = parseConfig(`
sections:
  - id: t
    title: T
    blocks:
      - totp:
          - uri: "otpauth://totp/ACME:me%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=ACME&digits=8&period=60&algorithm=SHA256"
`);
  const t = data.sections[0].blocks[0].items[0];
  assert.deepEqual(t, { name: 'ACME', account: 'me@example.com', secret: 'JBSWY3DPEHPK3PXP', digits: 8, period: 60, algorithm: 'SHA256' });
});

test('設定：TOTP を複数の章・小見出しに分けられる', () => {
  const { data } = parseConfig(`
sections:
  - id: personal
    title: TOTP
    blocks:
      - type: totp
        title: ACCOUNT
        items: [{ name: A, secret: JBSWY3DPEHPK3PXP }]
      - type: totp
        title: SOCIAL
        items: [{ name: B, secret: JBSWY3DPEHPK3PXP }]
  - id: work
    title: WORK
    blocks:
      - totp: [{ name: C, secret: JBSWY3DPEHPK3PXP }]
`);
  const [p, w] = data.sections;
  assert.deepEqual(p.blocks.map((b) => [b.type, b.title, b.items[0].name]), [['totp', 'ACCOUNT', 'A'], ['totp', 'SOCIAL', 'B']]);
  assert.deepEqual(w.blocks.map((b) => [b.type, b.title, b.items[0].name]), [['totp', '', 'C']]);
});

test('設定：章の背景（sectionStyle）は既定 meaning、知らない値は止める', () => {
  const body = 'sections:\n  - id: a\n    title: A\n    blocks:\n      - text: x\n';
  assert.equal(parseConfig(body).site.ui.sectionStyle, 'meaning');
  assert.equal(parseConfig('site:\n  ui:\n    sectionStyle: index\n' + body).site.ui.sectionStyle, 'index');
  assert.throws(() => parseConfig('site:\n  ui:\n    sectionStyle: stripes\n' + body), /sectionStyle/);
});

test('見本の設定ファイルはすべて読める', () => {
  for (const f of ['vault.example.yaml', 'examples/many.yaml', 'examples/few.yaml']) {
    const { data } = parseConfig(readFileSync(f, 'utf8'));
    assert.ok(data.sections.length > 0, f);
  }
});

test('HTML を作る：平文が入らず、取り出して開ける、鍵を使い回せる', async () => {
  const text = readFileSync('vault.example.yaml', 'utf8');
  const cfg = parseConfig(text);
  const keys = await createKeys(FAST, 'test passphrase 123');
  const { html } = await produce({ cfg, configText: text, keys });

  for (const secret of ['correct-horse-battery-staple', 'Xk29-pq7L-c0nO-88vR', 'JBSWY3DPEHPK3PXP', '3920 1847', 'password.txt', '山田 花子']) {
    assert.ok(!html.includes(secret), `平文が入っている: ${secret}`);
  }
  assert.ok(html.includes('Content-Security-Policy'));
  assert.ok(html.includes('noindex'));

  const vault = extractVault(html);
  const res = await core.unlock(vault, 'test passphrase 123');
  assert.equal(res.payload.yaml, text);
  assert.deepEqual(res.payload.data, cfg.data);

  // 2 回目のビルドは同じ鍵スロットを使い回す（合言葉 1 つで更新できる）
  const again = await reuseKeys(vault, 'test passphrase 123');
  assert.ok(again);
  const second = await produce({ cfg, configText: text, keys: again });
  const v2 = extractVault(second.html);
  assert.deepEqual(v2.slots, vault.slots);
  assert.notEqual(v2.iv, vault.iv);
  assert.equal(await reuseKeys(v2, 'wrong passphrase'), null);
});

test('公開部分（site:）に非公開の値を書くと止まる', async () => {
  const text = `
site:
  lock:
    greeting: "合言葉は Xk29-pq7L-c0nO-88vR"
sections:
  - id: a
    title: A
    blocks:
      - entries:
          - { name: X, fields: [{ label: PW, value: Xk29-pq7L-c0nO-88vR, secret: true }] }
`;
  const cfg = parseConfig(text);
  const keys = await createKeys(FAST, 'test passphrase 123');
  await assert.rejects(produce({ cfg, configText: text, keys }), /公開部分/);
});

test('公開部分の漏洩チェック：完全一致や記号を含む値も止める', async () => {
  const keys = await createKeys(FAST, 'test passphrase 123');
  for (const secret of ['Xk29-pq7L-c0nO-88vR', 'pa"ss\\word<1>']) {
    const text = `site:\n  lock:\n    greeting: ${JSON.stringify(secret)}\nsections:\n  - id: a\n    title: A\n    blocks:\n      - entries:\n          - { name: X, fields: [{ label: PW, value: ${JSON.stringify(secret)}, secret: true }] }\n`;
    await assert.rejects(produce({ cfg: parseConfig(text), configText: text, keys }), /公開部分/, secret);
  }
});

test('改ざんされた鍵導出パラメータは拒否する', async () => {
  const dek = core.newDek();
  const vault = await core.seal(dek, [await core.makeSlot('pass phrase 123', dek, FAST)], { x: 1 });
  vault.slots[0].kdf = { alg: 'argon2id', m: 1024, t: 100000000, p: 1 };
  await assert.rejects(core.unlock(vault, 'pass phrase 123'), /鍵導出/);
});
