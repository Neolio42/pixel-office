import { createServer } from 'http';
import { execSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import next from 'next';
import { initWSS } from './src/lib/ws-server';
import { startStaleSessionCleanup } from './src/lib/cleanup';
import { startStateTracker } from './src/lib/state-tracker';

const dev = process.env.NODE_ENV !== 'production';
const SOCKET_PATH = process.env.PIXEL_OFFICE_SOCKET || '/tmp/pixel-office.sock';

const app = next({ dev });
const handle = app.getRequestHandler();

// Check shfmt availability
try {
  execSync('shfmt --version', { stdio: 'pipe' });
} catch {
  console.warn('⚠  shfmt not found — compound bash commands will default to "needs approval"');
  console.warn('   Install: brew install shfmt (macOS) or go install mvdan.cc/sh/v3/cmd/shfmt@latest');
}

const port = parseInt(process.env.PORT || '3000', 10);

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res);
  });

  initWSS(server);
  startStaleSessionCleanup();
  startStateTracker();

  // TCP listener for browser (iTerm panel, canvas UI)
  server.listen(port, '127.0.0.1', () => {
    console.log(`> Pixel Office ready on http://localhost:${port}`);
  });

  // Unix socket listener for hooks (reliable, no port conflicts)
  const hookServer = createServer((req, res) => {
    handle(req, res);
  });

  // Clean up stale socket file from previous crash
  if (existsSync(SOCKET_PATH)) {
    try { unlinkSync(SOCKET_PATH); } catch { /* ignore */ }
  }

  hookServer.listen(SOCKET_PATH, () => {
    console.log(`> Hook socket ready at ${SOCKET_PATH}`);
  });

  // Clean up socket on exit
  function cleanup() {
    try { unlinkSync(SOCKET_PATH); } catch { /* ignore */ }
    process.exit(0);
  }
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
});
