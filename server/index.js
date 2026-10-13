import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Local settings (Mailgun keys, APP_URL, ...) from .env; real environment variables win.
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const PORT = Number(process.env.PORT) || 3000;

const app = createApp({
  dataDir: process.env.DATA_DIR || path.join(root, 'data'),
  seedDir: path.join(root, 'data', 'seed'),
  distDir: path.join(root, 'client', 'dist'),
});

app.listen(PORT, () => console.log(`dm-screen listening on http://localhost:${PORT}`));
