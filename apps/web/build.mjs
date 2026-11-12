import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const source = fileURLToPath(new URL('.', import.meta.url));
const destination = join(source, 'dist');
const siteKey = process.env.OFFLINESMS_WEB_APP_CHECK_SITE_KEY?.trim() ?? '';

const { outputFiles: [script] } = await build({
  absWorkingDir: source,
  entryPoints: ['app.js'],
  bundle: true,
  // Pure TypeScript modules shared with mobile need no Expo build settings.
  tsconfigRaw: { compilerOptions: {} },
  define: { __OFFLINESMS_WEB_APP_CHECK_SITE_KEY__: JSON.stringify(siteKey) },
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

await rm(destination, { recursive: true, force: true });
await mkdir(destination);
await Promise.all([
  writeFile(join(destination, 'app.js'), script.contents),
  cp(join(source, 'index.html'), join(destination, 'index.html')),
  ...assets.map(({ name }) => cp(join(source, name), join(destination, name))),
]);
