import { issueSignedToken, presignUrl } from '@vercel/blob';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const jwks = createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'));

async function verifyGitHubOidc(token) {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: 'https://token.actions.githubusercontent.com',
    audience: 'felid-daily-tracks',
  });
  if (payload.repository !== 'eguchi64thnote-ctrl/felid-sampler') throw new Error('Repository mismatch');
  const onMain = payload.ref === 'refs/heads/main' ||
    String(payload.job_workflow_ref || '').endsWith('@refs/heads/main') ||
    String(payload.workflow_ref || '').endsWith('@refs/heads/main');
  if (!onMain) throw new Error('Main branch required');
  return payload;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { pathname, contentType, oidc } = body;
    if (!pathname || !oidc) return res.status(400).json({ error: 'Missing fields' });
    if (!pathname.startsWith('daily/')) return res.status(400).json({ error: 'Invalid pathname' });
    const allowed = ['audio/wav', 'application/json'];
    if (!allowed.includes(contentType)) return res.status(400).json({ error: 'Invalid content type' });
    await verifyGitHubOidc(oidc);

    const max = contentType === 'audio/wav' ? 64 * 1024 * 1024 : 2 * 1024 * 1024;
    const validUntil = Date.now() + 15 * 60 * 1000;
    const token = await issueSignedToken({
      pathname,
      operations: ['put'],
      validUntil,
      allowedContentTypes: [contentType],
      maximumSizeInBytes: max,
    });
    const { presignedUrl } = await presignUrl(token, {
      operation: 'put',
      pathname,
      access: 'private',
      validUntil,
      allowedContentTypes: [contentType],
      maximumSizeInBytes: max,
      allowOverwrite: true,
    });
    return res.status(200).json({ pathname, presignedUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('sign-upload failed:', message);
    const authError = /Repository mismatch|Main branch required|JWT|signature|audience|issuer/i.test(message);
    return res.status(authError ? 401 : 500).json({
      error: authError ? 'Unauthorized' : 'Upload signing failed',
      detail: message,
    });
  }
}
