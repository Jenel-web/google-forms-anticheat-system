import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const at = (p) => fileURLToPath(new URL(p, import.meta.url));

// Port 3000 matches site_url in supabase/config.toml, so email confirmation links land here.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': at('../extension/src/shared'), '@design': at('../CheatNoNo') } },
  server: { host: '127.0.0.1', port: 3000, strictPort: true, fs: { allow: [at('..')] } },
  preview: { host: '127.0.0.1', port: 3000, strictPort: true },
});
