// One-off maintenance runner. Receives an expiring GitHub OIDC token from Actions
// and asks the Vercel production function to delete the connected Blob store's
// files in batches. No Blob credentials or file URLs enter public GitHub logs.
const API = 'https://karesansui-in-the-air-gnr-mhver.vercel.app/api/purge-felid-blob';
const AUDIENCE = 'felid-blob-purge-v1';
const WORKFLOW = 'purge-felid-blob.yml';
const END = Date.parse('2026-10-14T00:00:00Z');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function disableScheduledPurge() {
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPOSITORY) {
    throw new Error('GitHub workflow disable authorization unavailable');
  }
  const url = 'https://api.github.com/repos/' +
    process.env.GITHUB_REPOSITORY + '/actions/workflows/' + WORKFLOW + '/disable';
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer ' + process.env.GITHUB_TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error('Could not disable cleanup workflow, HTTP ' + response.status);
  console.log('Automatic cleanup workflow disabled after completion or expiration');
}

if (Date.now() > END) {
  console.log('One-time cleanup window expired: no further delete requests');
  await disableScheduledPurge();
  process.exit(0);
}

if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL ||
    !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
  throw new Error('GitHub OIDC required; cannot continue safely');
}

let count = 0;
for (let round = 1; round <= 100; round++) {
  const oidcUrl = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  oidcUrl.searchParams.set('audience', AUDIENCE);
  const oidc = await fetch(oidcUrl, {
    headers: { Authorization: 'bearer ' + process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN },
  });
  if (!oidc.ok) throw new Error('GitHub OIDC fetch failed, HTTP ' + oidc.status);
  const identity = (await oidc.json()).value;
  if (!identity) throw new Error('Missing workflow identity');

  const response = await fetch(API, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + identity,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'DELETE_ALL_FELID_BLOB_FILES' }),
  });

  let body;
  try { body = await response.json(); } catch { body = {}; }
  if (!response.ok) {
    throw new Error('Cleanup endpoint returned HTTP ' + response.status + ': ' +
      (body.error || 'no details') +
      '. If the Blob store is suspended, this workflow will retry on the next scheduled run.');
  }
  if (!Number.isInteger(body.deleted) || body.deleted < 0 || typeof body.empty !== 'boolean') {
    throw new Error('Unexpected cleanup response; stop for safety');
  }

  count += body.deleted;
  console.log('Delete batch ' + round + ': deleted ' + body.deleted + ', total ' + count);
  if (body.empty) {
    console.log('VERIFIED: connected FeLid Blob store is EMPTY (0 stored objects)');
    await disableScheduledPurge();
    process.exit(0);
  }
  if (body.deleted === 0) throw new Error('No progress while Blob store still contains objects');
  await sleep(1200);
}
throw new Error('Cleanup stopped after 100 batches; remaining objects need further run');
