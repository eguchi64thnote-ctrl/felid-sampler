import { randomBytes, createCipheriv, createHash } from 'node:crypto';

// AES-256-GCM. GitHub artifacts contain encrypted WAV bytes ONLY.
// Format: UTF-8 "FELIDWAV1" (9 bytes) | IV (12 bytes) | tag (16 bytes) | ciphertext.
// Keep the random 32-byte key in the private Vercel Blob metadata, NOT in GitHub.
export function encryptWav(wav) {
  if (!Buffer.isBuffer(wav)) throw new TypeError('WAV buffer expected');
  if (wav.length < 44 || wav.subarray(0, 4).toString('ascii') !== 'RIFF') {
    throw new Error('Invalid WAV source');
  }
  const keyBytes = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes, iv);
  const ciphertext = Buffer.concat([cipher.update(wav), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    data: Buffer.concat([Buffer.from('FELIDWAV1', 'utf8'), iv, tag, ciphertext]),
    key: keyBytes.toString('base64url'),
    sha256: createHash('sha256').update(wav).digest('hex'),
  };
}
