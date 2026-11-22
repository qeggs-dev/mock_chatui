// Minimal CDP screenshot/eval harness for the mock_chatui pages (local only).
// Usage: node tools/shot.mjs --url chat.html --out ../screenshots/chat.png [--width 1440] [--height 950] [--mobile] [--eval "js"] [--evalfile foo.js] [--dataout out.png] [--wait 1400]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const k = a.slice(2);
  const next = process.argv[i + 1];
  if (next !== undefined && !next.startsWith('--')) {
    args[k] = next;
    i++;
  } else {
    args[k] = true;
  }
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const url = args.url.startsWith('http') ? args.url : pathToFileURL(path.resolve(root, args.url)).href;
const out = args.out ? path.resolve(root, args.out) : path.join(root, 'screenshots', 'shot.png');
const width = Number(args.width) || 1440;
const height = Number(args.height) || 950;
const wait = Number(args.wait) || 1400;
const mobile = !!args.mobile;
const port = 9300 + Math.floor(Math.random() * 300);
const profile = path.join(os.tmpdir(), 'mock_chatui-cdp-' + process.pid);
const edge =
  ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(
    (p) => fs.existsSync(p)
  ) || 'msedge.exe';

fs.mkdirSync(path.dirname(out), { recursive: true });

const proc = spawn(
  edge,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    'about:blank',
  ],
  { stdio: 'ignore', windowsHide: true }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitVersion() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(120);
  }
  throw new Error('Edge CDP did not start');
}

const version = await waitVersion();
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((t) => t.type === 'page') || targets[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});

let nextId = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.rej(new Error(JSON.stringify(msg.error)));
    else p.res(msg.result);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    errors.push('EXCEPTION: ' + (d.exception && (d.exception.description || d.exception.value)) || d.text);
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push('CONSOLE: ' + msg.params.args.map((a) => a.value || a.description || '').join(' '));
  }
});
function send(method, params) {
  return new Promise((res, rej) => {
    const id = ++nextId;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: mobile ? 2 : 1,
    mobile,
    screenWidth: width,
    screenHeight: height,
  });
  if (mobile) {
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }
  const nav = await send('Page.navigate', { url });
  await sleep(wait);
  await send('Runtime.evaluate', {
    expression:
      "document.fonts && document.fonts.ready ? document.fonts.ready.then(() => new Promise(r => setTimeout(r, 260))) : new Promise(r => setTimeout(r, 260))",
    awaitPromise: true,
    returnByValue: true,
  });
  await sleep(250);

  if (args.eval || args.evalfile) {
    let expression = args.eval || '';
    if (args.evalfile) expression = fs.readFileSync(path.resolve(root, args.evalfile), 'utf8');
    const r = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      errors.push(
        'EVAL EXCEPTION: ' +
          (r.exceptionDetails.exception
            ? r.exceptionDetails.exception.description || r.exceptionDetails.exception.value
            : r.exceptionDetails.text)
      );
    } else if (r.result && r.result.value !== undefined) {
      const value = r.result.value;
      if (typeof value === 'string' && value.startsWith('data:image/png;base64,') && args.dataout) {
        const target = path.resolve(root, args.dataout);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, Buffer.from(value.split(',')[1], 'base64'));
        console.log('DATAOUT ' + target);
      } else {
        console.log('EVAL ' + JSON.stringify(value).slice(0, 1200));
      }
    }
  }

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('SHOT ' + out + ' ' + width + 'x' + height);
  if (errors.length) console.log('ERRORS\n' + errors.join('\n'));
  else console.log('ERRORS none');
} finally {
  try {
    await send('Browser.close');
  } catch {}
  ws.close();
  await sleep(500);
  try {
    proc.kill();
  } catch {}
  await sleep(200);
}
