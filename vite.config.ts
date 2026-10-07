import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'atlas-development-csp',
      apply: 'serve',
      // Vite injects an inline refresh preamble in development. Production keeps the CSP.
      transformIndexHtml: (html) =>
        html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*\/?>/, ''),
    },
    {
      name: 'atlas-offline-assets',
      apply: 'build',
      writeBundle(options, bundle) {
        const assets = Object.keys(bundle)
          .filter((path) => path !== 'index.html' && path !== 'sw.js')
          .sort();
        const revision = createHash('sha256').update(assets.join('\n')).digest('hex').slice(0, 12);
        const worker = readFileSync(resolve('public/sw.js'), 'utf8')
          .replace('atlas-shell-v1', 'atlas-shell-' + revision)
          .replace(
            '/* ATLAS_ASSETS */',
            assets.map((path) => ',' + JSON.stringify('/' + path)).join(''),
          );
        writeFileSync(resolve(options.dir ?? 'dist', 'sw.js'), worker);
      },
    },
  ],
  test: { include: ['src/**/*.test.{ts,tsx}'], environment: 'node' },
});
