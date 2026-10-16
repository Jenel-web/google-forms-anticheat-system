// Builds extension/dist/ (load that folder unpacked). Usage: node build.mjs [supabase|mock]   (default: supabase)
// The source folder itself still runs unpacked with the mock backend (that is what the e2e test loads).
import { build } from 'esbuild';
import { cp, rm, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const backend = process.argv[2] || process.env.BACKEND || 'supabase';
if (!['supabase', 'mock'].includes(backend)) throw new Error('BACKEND must be supabase or mock, got: ' + backend);

const dist = join(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

// Everything except the service worker is copied as-is (content scripts are classic scripts, not bundled).
await cp(join(root, 'manifest.json'), join(dist, 'manifest.json'));
await cp(join(root, 'src'), join(dist, 'src'), {
  recursive: true,
  filter: (src) => !src.includes(join('src', 'background')),
});

// backend.js stays the only import site; the build flag decides what it resolves to.
const pickBackend = {
  name: 'pick-backend',
  setup(b) {
    b.onResolve({ filter: /(^|\/)backend\.js$/ }, (args) => ({
      path: resolve(root, 'src/background', `backend.${backend}.js`),
    }));
  },
};

await build({
  entryPoints: [join(root, 'src/background/background.js')],
  outfile: join(dist, 'src/background/background.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome110',
  plugins: [pickBackend],
  logLevel: 'info',
});

console.log(`Built extension/dist with the ${backend} backend. Load it unpacked from chrome://extensions.`);
