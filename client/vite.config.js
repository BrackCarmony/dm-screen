import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  // The MCP endpoint and its OAuth endpoints live on the API server too.
  server: { proxy: Object.fromEntries(['/api', '/mcp', '/authorize', '/token', '/register', '/revoke', '/.well-known'].map((p) => [p, 'http://localhost:3000'])) },
  build: { outDir: 'dist', emptyOutDir: true },
});
