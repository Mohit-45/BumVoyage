import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');
const sheetDir = path.join(here, 'sheet');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const argv = process.argv.slice(2);
const opt = { out: 'sheets', views: 'game,back,side,front,top,face', heat: '0', charge: '0', kick: '0', walk: '0', w: '800', h: '600', suffix: '', crew: '' };
const ids = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[++i];
  else ids.push(argv[i]);
}
if (!ids.length) ids.push('leo', 'zeke', 'gerry', 'hattie', 'milo', 'ringo');
mkdirSync(opt.out, { recursive: true });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const isSheet = url.pathname.startsWith('/sheet/');
  const root = isSheet ? sheetDir : publicDir;
  const rel = isSheet ? url.pathname.slice('/sheet/'.length) : url.pathname;
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--hide-scrollbars'],
});
const files = [];
try {
  for (const id of ids) {
    for (const view of opt.views.split(',')) {
      const page = await browser.newPage();
      await page.setViewport({ width: Number(opt.w), height: Number(opt.h) });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      const url = `http://localhost:${port}/sheet/sheet.html?char=${id}&view=${view}&heat=${opt.heat}&charge=${opt.charge}&kick=${opt.kick}&walk=${opt.walk}&w=${opt.w}&h=${opt.h}${opt.crew ? `&crew=${opt.crew}` : ''}`;
      await page.goto(url);
      try {
        await page.waitForFunction('window.__ready === true', { timeout: 30000 });
      } catch {
        console.error(`render failed for ${id}/${view}: ${errors.join(' | ') || 'timeout'}`);
        await page.close();
        continue;
      }
      const file = path.resolve(opt.out, `${id}-${view}${opt.suffix}.png`);
      await page.screenshot({ path: file });
      files.push(file);
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
console.log(files.join('\n'));
