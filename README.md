# FeLid Magic Hour Generator

Generative ambient / experimental sound instrument built from **FeLid – Magic Hour** source material.

## Deploy to Vercel

[Deploy with Vercel](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Feguchi64thnote-ctrl%2Ffelid-sampler)

The repository is configured as a static PWA and includes the nine Magic Hour source cells used by the generator.

## FeLid Daily Tracks — no-charge MP3 archive + one-day WAV export

This project uses the existing **Vercel Hobby + GitHub Actions** services. The default
Daily Tracks workflow does **not** require Cloudflare R2 or a billing card.

### Automatic generation (Tokyo time)

- At 06:00, 12:00 and 16:00, generate 3 WAV masters (AmbientSpace, GrooveRhythm, ExperimentalMutation).
- Convert each rendered master using ffmpeg into a **stereo 96 kbps MP3** for private preview.
- Upload the MP3 plus existing params JSON and a private access manifest to Vercel Blob.
- Encrypt each original WAV in the GitHub Actions runner using AES-256-GCM and a
  **separate random key for each track**. Upload ONLY ciphertext to GitHub Actions
  Artifacts (one ZIP per time slot, retention `1 day`). Never upload plaintext WAV
  to the public GitHub repository or an unencrypted artifact.
- Save the encryption keys **only** in private Vercel Blob access metadata; they
  become available to an authorized viewer of the private inbox.

### Save your favorite WAV on your Mac

1. Open your existing private Daily Tracks Inbox URL, choose a date, and listen to the MP3s.
2. Next to a track, open **① WAV暗号化ZIPを入手**, log into GitHub, and download
   the time-slot ZIP from **Artifacts** at the bottom of that run's page.
3. Unzip it on the Mac. Open **② WAVを復元して保存** from that track in the inbox.
4. Choose the exact `.wav.enc` file shown on the page. The browser decrypts it
   entirely **locally**, verifies the AES-GCM authentication tag, and downloads the
   original lossless WAV to your Mac. The key is passed in the URL fragment and
   removed from browser history as soon as the restoration page loads.

**Time limit:** GitHub retains these encrypted ZIPs for about 24 hours. If a
master is important, download it on the day of generation. The MP3 preview
remains until the Vercel Hobby storage limit is reached or an explicitly
approved retention policy is implemented; there is currently **no automatic
deletion of any stored WAV or MP3**.

**Storage limitations:** 9 stereo MP3 tracks at 96 kbps and 2–3 minutes each
use approximately 13–19 MB per day (about 0.4–0.6 GB over 30 days). Vercel
Blob Hobby has about 1 GB of included average storage. This is not unlimited
long-term free storage. GitHub Free has 500 MB of included artifact storage
(shared with other artifacts); 1-day retention substantially reduces use but
does not guarantee that the account will never hit a limit. Set **zero spending
limits** for GitHub usage-based billing where applicable; do not enable overages.

### Do not delete the original archived WAVs before backup

The existing Vercel Blob store was suspended after reaching its free quota
on October 10, 2026; the dashboard said access would resume on October 11.
Existing 1.02 GB of WAVs remain in Blob until explicitly backed up or removed.
Converting future output to MP3 does **not** reduce that 1.02 GB.

1. Once Vercel Blob access resumes, open your existing archive and save each
   old WAV to your Mac. Verify that the downloaded files play correctly.
2. Keep the originals in Vercel Blob until you explicitly confirm that local
   backups are complete. **This repository contains no automatic WAV deletion.**
3. Only after confirmation, separately plan a manual cleanup of old WAVs and
   a capped MP3 retention window to stay safely below 1 GB.

Cloudflare R2 support remains dormant code from a previous experiment; do not
configure it if you want to avoid potential usage charges. No R2 bucket, token,
payment method, or account upgrade is necessary for this zero-cost option.
