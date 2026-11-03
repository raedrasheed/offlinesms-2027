/* Pinned Linux x64 media tools for Cloud Functions. No unverified binary fallback. */
'use strict';
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { execFileSync } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createWriteStream } = require('node:fs');

const VERSION = 'n8.1.3-27-g8dca1586f4';
const RELEASE = 'autobuild-2026-10-31-12-59';
const ARCHIVE = `ffmpeg-${VERSION}-linux64-gpl-shared-8.1.tar.xz`;
const SHA256 = '202fe67679a0860b155817a0907ffcc5c1ea82e186acaa21cb87d307f54fd59a';
const URL = `https://github.com/BtbN/FFmpeg-Builds/releases/download/${RELEASE}/${ARCHIVE}`;
const root = resolve(__dirname, '..', '.media-tools');
const hash = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');

async function cached() {
  try {
    const manifest = JSON.parse(await fs.readFile(join(root, 'manifest.json'), 'utf8'));
    if (manifest.archiveSha256 !== SHA256 || manifest.version !== VERSION) return false;
    if (!manifest.files?.['bin/ffmpeg'] || !manifest.files?.['bin/ffprobe']) return false;
    for (const [file, expected] of Object.entries(manifest.files)) {
      if (!/^(bin|lib)\/[A-Za-z0-9_.+-]+$/.test(file) || await hash(join(root, file)) !== expected) return false;
    }
    return true;
  } catch { return false; }
}

async function main() {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    console.log('Clip video processing requires Linux x64. Use the documented Linux container for media tests.');
    return;
  }
  if (await cached()) { console.log(`Verified cached FFmpeg/ffprobe ${VERSION}`); return; }
  const temporary = await fs.mkdtemp(join(resolve(__dirname, '..'), '.media-tools-install-'));
  try {
    console.log(`Installing verified FFmpeg/ffprobe ${VERSION} (${RELEASE})`);
    const archive = join(temporary, ARCHIVE);
    const response = await fetch(URL, { signal: AbortSignal.timeout(240_000) });
    if (!response.ok || !response.body) throw new Error(`Media archive download failed: HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
    if (await hash(archive) !== SHA256) throw new Error('Media archive SHA-256 mismatch');
    const extracted = join(temporary, 'extracted'); await fs.mkdir(extracted);
    execFileSync('tar', ['-xJf', archive, '--strip-components=1', '-C', extracted], { timeout: 90_000 });
    const files = {};
    for (const folder of ['bin', 'lib']) {
      for (const file of await fs.readdir(join(extracted, folder))) {
        if ((await fs.stat(join(extracted, folder, file))).isDirectory()) continue;
        if (folder === 'bin' && !['ffmpeg', 'ffprobe'].includes(file)) { await fs.rm(join(extracted, folder, file)); continue; }
        files[`${folder}/${file}`] = await hash(join(extracted, folder, file));
      }
    }
    const env = { ...process.env, LD_LIBRARY_PATH: join(extracted, 'lib') };
    for (const binary of ['ffmpeg', 'ffprobe']) {
      const path = join(extracted, 'bin', binary); await fs.chmod(path, 0o755);
      const version = execFileSync(path, ['-version'], { encoding: 'utf8', env, timeout: 10_000 }).split('\n')[0];
      if (!version.includes(VERSION)) throw new Error(`Unexpected ${binary} version: ${version}`);
      console.log(version);
    }
    await fs.writeFile(join(extracted, 'manifest.json'), JSON.stringify({ version: VERSION, release: RELEASE, url: URL, archiveSha256: SHA256, files }, null, 2));
    // The archive retains its upstream LICENSE and build/source information.
    if (!existsSync(join(extracted, 'LICENSE.txt'))) throw new Error('Media bundle license missing');
    await fs.rm(root, { recursive: true, force: true });
    await fs.rename(extracted, root);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
