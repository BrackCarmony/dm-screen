// Runs the MCP server for a local client such as Claude Code, which starts this file and talks JSON-RPC
// on stdin/stdout. stdout belongs to the protocol, so logs go to stderr (console.error), never console.log.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './mcp.js';
import { createDmStore, createUserStore } from './store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const dataDir = process.env.DATA_DIR || path.join(root, 'data');

// DM_EMAIL picks the DM; without it, the first account (the admin).
const email = process.env.DM_EMAIL?.toLowerCase();
const users = createUserStore(dataDir).all();
const dm = email ? users.find((u) => u.email === email) : users[0];
if (!dm) throw new Error(email ? `no account with email ${email}` : `no accounts in ${dataDir}`);

const server = createMcpServer({ dms: createDmStore(dataDir, path.join(root, 'data', 'seed')), dm });
await server.connect(new StdioServerTransport());
console.error(`dm-screen MCP server ready for ${dm.name} (${dm.email}), data in ${dataDir}`);
