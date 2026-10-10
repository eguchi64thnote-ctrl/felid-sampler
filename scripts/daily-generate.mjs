import { chromium } from 'playwright';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { encryptWav } from '../lib/wav-encryption.js';
import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const baseUrl = process.env.DAILY_BASE_URL || 'https://karesansui-in-the-air-gnr-mhver.vercel.app';
const slot = process.env.DAILY_SLOT || (() => {
  const h=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tokyo',hour:'2-digit',hour12:false}).format(new Date()));
  return h<9?'0600':h<15?'1200':'1600';
})();
async function getFreshOidc() {
  if (process.env.ACTIONS_ID_TOKEN_REQUEST_URL && process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    const sep = process.env.ACTIONS_ID_TOKEN_REQUEST_URL.includes('?') ? '&' : '?';
    const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL + sep + 'audience=felid-daily-tracks';
    const res = await fetch(url, {
      headers: { Authorization: 'bearer ' + process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN },
    });
    if (!res.ok) throw new Error('OIDC refresh failed: ' + res.status + ' ' + await res.text());
    const data = await res.json();
    if (!data.value) throw new Error('OIDC refresh returned no token');
    return data.value;
  }
  if (process.env.GITHUB_OIDC_TOKEN) return process.env.GITHUB_OIDC_TOKEN;
  throw new Error('Missing GitHub OIDC token source');
}

const execFileAsync = promisify(execFile);
const outDir = path.resolve('daily-output');
const encryptedDir = path.resolve('daily-output-encrypted');
await mkdir(encryptedDir, { recursive: true });
await mkdir(outDir, { recursive: true });

function tokyoDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function quotaLike(status, text='') {
  return status === 402 || status === 403 || status === 409 || status === 429 ||
    /quota|limit|usage|capacity|storage|exceed|billing|payment|required|insufficient/i.test(text);
}
function uploadError(stage, status, text) {
  if (quotaLike(status, text)) {
    const err = new Error('DAILY_TRACKS_STORAGE_LIMIT: Free storage/usage limit appears to be reached. Today\'s Daily Tracks could not be archived. ' + stage + ' ' + status + ' ' + text);
    err.code = 'DAILY_TRACKS_STORAGE_LIMIT';
    return err;
  }
  return new Error(stage + ': ' + status + ' ' + text);
}

const R2_VARS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'];
const r2Present = R2_VARS.filter(key => Boolean(process.env[key]));
if (r2Present.length > 0 && r2Present.length !== R2_VARS.length) {
  throw new Error('Incomplete R2 configuration: all four R2_* variables are required.');
}
const r2Ready = r2Present.length === R2_VARS.length;
const r2 = r2Ready ? new S3Client({
  region: 'auto',
  endpoint: 'https://' + process.env.R2_ACCOUNT_ID + '.r2.cloudflarestorage.com',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
}) : null;

// Validate the destination before spending minutes rendering three tracks.
// Never print credentials or private audio URLs in GitHub Actions logs.
if (r2Ready) {
  await r2.send(new ListObjectsV2Command({
    Bucket: process.env.R2_BUCKET_NAME, Prefix: 'daily/_health/', MaxKeys: 1,
  }));
}
console.log('Daily Tracks archive backend: ' + (r2Ready ? 'Cloudflare R2 (private)' : 'legacy Vercel Blob'));

async function uploadFile(filePath, date) {
  const name = path.basename(filePath);
  const contentType = name.endsWith('.wav') ? 'audio/wav' : name.endsWith('.mp3') ? 'audio/mpeg' : 'application/json';
  const pathname = 'daily/' + date + '/' + slot + '/' + name;
  const bytes = await readFile(filePath);

  if (r2Ready) {
    await r2.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME, Key: pathname,
      ContentType: contentType, Body: bytes, ContentLength: bytes.length,
    }));
    return pathname;
  }

  const oidc = await getFreshOidc();
  const sign = await fetch(baseUrl + '/api/sign-upload', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pathname, contentType, oidc }),
  });
  if (!sign.ok) {
    const detail = await sign.text();
    throw uploadError('Sign upload failed', sign.status, detail);
  }
  const { presignedUrl } = await sign.json();
  const put = await fetch(presignedUrl, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    body: bytes,
  });
  if (!put.ok) {
    const detail = await put.text();
    throw uploadError('Blob upload failed', put.status, detail);
  }
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
  await page.goto(baseUrl + '/?daily_automation=1&slot=' + encodeURIComponent(slot), { waitUntil: 'networkidle', timeout: 120_000 });
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
const runId = process.env.GITHUB_RUN_ID || '';
if (!/^\d+$/.test(runId)) throw new Error('GitHub Actions run id is required to offer temporary WAV downloads');

// MP3 copies are stored for preview. The original WAVs are NOT uploaded to
// Blob, eliminating the largest recurring storage cost.
const outputFiles = await readdir(outDir);
const wavFiles = outputFiles.filter(name => name.toLowerCase().endsWith('.wav')).sort();
if (wavFiles.length !== 3) throw new Error('Expected exactly 3 rendered WAV files');
const mp3Files = [];
const encryptedFiles = [];
const artifactName = 'felid-wav-' + date + '-' + slot + '-' + runId;

for (const wavName of wavFiles) {
  const wavPath = path.join(outDir, wavName);
  const mp3Name = wavName.replace(/\.wav$/i, '.mp3');
  await execFileAsync('ffmpeg', [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-i', wavPath, '-vn', '-codec:a', 'libmp3lame',
    '-ar', '44100', '-ac', '2', '-b:a', '96k',
    path.join(outDir, mp3Name),
  ], { timeout: 120000 });
  mp3Files.push(mp3Name);

  // GitHub repo is public: artifacts MUST contain ciphertext only.
  // A random per-track key is stored only in the private Blob manifest.
  const wav = await readFile(wavPath);
  const encryptedName = randomBytes(16).toString('hex') + '.wav.enc';
  const sealed = encryptWav(wav);
  await writeFile(path.join(encryptedDir, encryptedName), sealed.data);
  encryptedFiles.push({
    wavName, encryptedName, key: sealed.key,
    sha256: sealed.sha256,
  });
}

const uploaded = [];
for (const name of [...mp3Files, ...outputFiles.filter(f => f.endsWith('_params.json'))]) {
  uploaded.push(await uploadFile(path.join(outDir, name), date));
}
const privateAccessPath = path.join(outDir, date + '_' + slot + '_wav-access.json');
await writeFile(privateAccessPath, JSON.stringify({
  version: 1, runId, artifactName,
  expiresAfterHours: 24,
  files: encryptedFiles,
}, null, 2));
uploaded.push(await uploadFile(privateAccessPath, date));

const manifestPath = path.join(outDir, date + '_' + slot + '_manifest.json');
await writeFile(manifestPath, JSON.stringify({
  date, slot, generatedAt: new Date().toISOString(),
  previewFormat: 'MP3 96kbps stereo',
  wavAvailability: 'Encrypted GitHub Actions artifact for approximately 24 hours',
  files: uploaded, source: baseUrl,
}, null, 2));
await uploadFile(manifestPath, date);

// Do not log the encryption keys or the private signed URLs.
console.log(JSON.stringify({ date, slot, uploaded, artifactName, encryptedWavs: encryptedFiles.length }, null, 2));
