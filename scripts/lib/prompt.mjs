// 端末に表示せずに合言葉を読む
import readline from 'node:readline';

let piped = null;
function nextPipedLine() {
  if (!piped) {
    piped = { lines: [], waiters: [], closed: false };
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    rl.on('line', (line) => {
      const w = piped.waiters.shift();
      if (w) w.resolve(line);
      else piped.lines.push(line);
    });
    rl.on('close', () => {
      piped.closed = true;
      for (const w of piped.waiters.splice(0)) w.reject(new Error('入力がありません'));
    });
  }
  if (piped.lines.length) return Promise.resolve(piped.lines.shift());
  if (piped.closed) return Promise.reject(new Error('入力がありません'));
  return new Promise((resolve, reject) => piped.waiters.push({ resolve, reject }));
}

export function readSecret(question) {
  const input = process.stdin;
  const output = process.stderr;

  if (!input.isTTY) {
    // パイプ入力（テストなど）：1 行ずつ順に渡す
    output.write(question + '\n');
    return nextPipedLine();
  }

  return new Promise((resolve, reject) => {
    output.write(question);
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    let value = '';
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          cleanup();
          output.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          cleanup();
          output.write('\n');
          reject(new Error('中断しました'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          if (value.length > 0) {
            value = [...value].slice(0, -1).join('');
            output.write('\b \b');
          }
          continue;
        }
        if (ch < ' ') continue;
        value += ch;
        output.write('*');
      }
    };
    const cleanup = () => {
      input.removeListener('data', onData);
      input.setRawMode(false);
      input.pause();
    };
    input.on('data', onData);
  });
}

export async function readLine(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return answer;
}

export async function readNewSecret(what) {
  for (;;) {
    const a = await readSecret(`${what}: `);
    if (a.length < 12) {
      process.stderr.write('  12 文字以上にしてください。\n');
      continue;
    }
    const b = await readSecret(`${what}（確認）: `);
    if (a !== b) {
      process.stderr.write('  一致しません。もう一度。\n');
      continue;
    }
    return a;
  }
}
