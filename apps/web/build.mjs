import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { isProductionFirebaseConfig } from './firebase-config.js';

const source = fileURLToPath(new URL('.', import.meta.url));
const destination = join(source, 'dist');
const siteKey = process.env.OFFLINESMS_WEB_APP_CHECK_SITE_KEY?.trim() ?? '';
const firebaseConfig = readFirebaseConfig();

function readFirebaseConfig() {
  const raw = process.env.OFFLINESMS_WEB_FIREBASE_CONFIG?.trim();
  if (!raw) {
    if (process.argv.includes('--require-firebase-config')) {
      throw new Error('Set OFFLINESMS_WEB_FIREBASE_CONFIG to the public Firebase Web SDK config.');
    }
    return null;
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    throw new Error('OFFLINESMS_WEB_FIREBASE_CONFIG must contain valid JSON.');
  }

  if (!isProductionFirebaseConfig(config) || typeof config.storageBucket !== 'string' || !config.storageBucket.trim()) {
    throw new Error('OFFLINESMS_WEB_FIREBASE_CONFIG must identify offlinesms-prod-2027 and include apiKey, appId, and storageBucket.');
  }

  // Publish only fields defined by the FirebaseOptions interface.
  const publicFields = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId'];
  return Object.fromEntries(publicFields.filter(key => typeof config[key] === 'string').map(key => [key, config[key]]));
}

const { outputFiles: [script] } = await build({
  absWorkingDir: source,
  entryPoints: ['app.js'],
  bundle: true,
  // Pure TypeScript modules shared with mobile need no Expo build settings.
  tsconfigRaw: { compilerOptions: {} },
  define: {
    __OFFLINESMS_WEB_APP_CHECK_SITE_KEY__: JSON.stringify(siteKey),
    __OFFLINESMS_WEB_FIREBASE_CONFIG__: JSON.stringify(firebaseConfig),
  },
  format: 'esm',
  target: 'es2022',
  minify: true,
  legalComments: 'eof',
  write: false,
});

// Keep package metadata, source modules, and any local configuration out of Hosting.
const assetExtensions = new Set(['.css', '.jpg', '.mp4', '.png', '.svg', '.webp']);
const entries = await readdir(source, { withFileTypes: true });
const assets = entries.filter(entry => entry.isFile() && assetExtensions.has(extname(entry.name)));
const stickerSource = fileURLToPath(new URL('../mobile/assets/stickers/simsim/', import.meta.url));
const pack = JSON.parse(await readFile(join(stickerSource, 'pack.json'), 'utf8'));
if (pack.id !== 'simsim' || !pack.stickers.every(({ id }) => /^[a-z0-9_]+$/.test(id))) {
  throw new Error('Unexpected bundled sticker catalog.');
}

await rm(destination, { recursive: true, force: true });
const stickerDestination = join(destination, 'stickers', pack.id);
await mkdir(stickerDestination, { recursive: true });
await Promise.all([
  writeFile(join(destination, 'app.js'), script.contents),
  cp(join(source, 'index.html'), join(destination, 'index.html')),
  ...assets.map(({ name }) => cp(join(source, name), join(destination, name))),
  ...pack.stickers.map(({ id }) => cp(join(stickerSource, `${id}.webp`), join(stickerDestination, `${id}.webp`))),
  cp(join(stickerSource, 'LICENSE.md'), join(stickerDestination, 'LICENSE.md')),
]);
