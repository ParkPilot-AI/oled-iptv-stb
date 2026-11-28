import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Strict CSP is injected only into production builds (the dev server needs inline
// react-refresh preamble scripts).
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' imgcache: data:; font-src 'self' data:; connect-src 'self'; object-src 'none'";

const cspPlugin = {
  name: 'inject-csp',
  apply: 'build',
  transformIndexHtml(html) {
    return html.replace(
      '<head>',
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`
    );
  },
};

// The demo backend (src/lib/mockApi.js) is only bundled for the dev server and
// `vite build --mode demo`; the Electron build (plain `vite build`) leaves it out.
export default defineConfig(({ command, mode }) => ({
  base: './',
  plugins: [react(), cspPlugin],
  define: { __DEMO__: JSON.stringify(command === 'serve' || mode === 'demo') },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome120',
    sourcemap: false,
  },
  server: { port: 5173, strictPort: true },
}));
