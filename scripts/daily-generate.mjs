import { chromium } from 'playwright';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.DAILY_BASE_URL || 'https://karesansui-in-the-air-gnr-mhver.vercel.app';
const oidc = process.env.GITHUB_OIDC_TOKEN;
if (!oidc) throw new Error('Missing GITHUB_OIDC_TOKEN');

const outDir = path.resolve('daily-output');
await mkdir(outDir, { recursive: true });

function tokyoDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

async function uploadFile(filePath, date) {
  const name = path.basename(filePath);
  const contentType = name.endsWith('.wav') ? 'audio/wav' : 'application/json';
  const pathname = 'daily/' + date + '/' + name;
  const sign = await fetch(baseUrl + '/api/sign-upload', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pathname, contentType, oidc }),
  });
  if (!sign.ok) throw new Error('Sign upload failed: ' + sign.status + ' ' + await sign.text());
  const { presignedUrl } = await sign.json();
  const bytes = await readFile(filePath);
  const put = await fetch(presignedUrl, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    body: bytes,
  });
  if (!put.ok) throw new Error('Blob upload failed: ' + put.status + ' ' + await put.text());
  return pathname;
}

const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(60_000);

let success = false;
for (let batchAttempt = 1; batchAttempt <= 2 && !success; batchAttempt++) {
  await page.goto(baseUrl + '/?daily_automation=1', { waitUntil: 'networkidle', timeout: 120_000 });
  await page.locator('#daily3').click();
  await page.waitForFunction(() => {
    const s = document.querySelector('#dailyStatus')?.textContent || '';
    return s.includes("TODAY'S 3 TRACKS READY") || s.includes('NOVELTY GATE STOPPED');
  }, null, { timeout: 60 * 60 * 1000 });
  const status = await page.locator('#dailyStatus').textContent();
  success = status.includes("TODAY'S 3 TRACKS READY");
}
if (!success) {
  await browser.close();
  throw new Error('Novelty Gate did not produce 3 accepted tracks');
}

const wavLinks = page.locator('#dailyResults a').filter({ hasText: 'WAV' });
const paramLinks = page.locator('#dailyResults a').filter({ hasText: 'PARAMS' });
if (await wavLinks.count() !== 3) throw new Error('Expected exactly 3 WAV links');

for (let i = 0; i < 3; i++) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    wavLinks.nth(i).click(),
  ]);
  await download.saveAs(path.join(outDir, download.suggestedFilename()));
  if (i < await paramLinks.count()) {
    const [meta] = await Promise.all([
      page.waitForEvent('download'),
      paramLinks.nth(i).click(),
    ]);
    await meta.saveAs(path.join(outDir, meta.suggestedFilename()));
  }
}
await browser.close();

const date = tokyoDate();
const uploaded = [];
for (const name of await readdir(outDir)) {
  uploaded.push(await uploadFile(path.join(outDir, name), date));
}
const manifestPath = path.join(outDir, date + '_manifest.json');
await writeFile(manifestPath, JSON.stringify({
  date,
  generatedAt: new Date().toISOString(),
  files: uploaded,
  source: baseUrl,
}, null, 2));
await uploadFile(manifestPath, date);

console.log(JSON.stringify({ date, uploaded }, null, 2));
