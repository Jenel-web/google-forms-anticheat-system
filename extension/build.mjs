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

// Hosted project: SUPABASE_URL and SUPABASE_ANON_KEY (both public). Unset = the local `supabase start` defaults.
const define = {};
if (process.env.SUPABASE_URL) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(process.env.SUPABASE_URL)) {
    throw new Error('SUPABASE_URL must look like https://<project-ref>.supabase.co');
  }
  if (!process.env.SUPABASE_ANON_KEY) throw new Error('Set SUPABASE_ANON_KEY together with SUPABASE_URL');
  if (/service_role|sb_secret_/.test(process.env.SUPABASE_ANON_KEY)) throw new Error('That is a secret key. Use the anon/publishable key only.');
  define.__SUPABASE_URL__ = JSON.stringify(process.env.SUPABASE_URL.replace(/\/$/, ''));
  define.__SUPABASE_ANON_KEY__ = JSON.stringify(process.env.SUPABASE_ANON_KEY);
}

await build({
  define,
  entryPoints: [join(root, 'src/background/background.js')],
  outfile: join(dist, 'src/background/background.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome110',
  plugins: [pickBackend],
  logLevel: 'info',
});

console.log(`Built extension/dist with the ${backend} backend${define.__SUPABASE_URL__ ? ` for ${JSON.parse(define.__SUPABASE_URL__)}` : ' (local stack)'}. Load it unpacked from chrome://extensions.`);
