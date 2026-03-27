import { createServer } from 'http';
import { execSync } from 'child_process';
import next from 'next';
import { initWSS } from './src/lib/ws-server';
import { startStaleSessionCleanup } from './src/lib/cleanup';

const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev });
const handle = app.getRequestHandler();

// Check shfmt availability — needed for AST-based bash command classification
try {
  execSync('shfmt --version', { stdio: 'pipe' });
} catch {
  console.warn('⚠  shfmt not found — compound bash commands will default to "needs approval"');
  console.warn('   Install: brew install shfmt (macOS) or go install mvdan.cc/sh/v3/cmd/shfmt@latest');
}

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res);
  });

  initWSS(server);

  startStaleSessionCleanup();

  server.listen(port, '127.0.0.1', () => {
    console.log(`> Pixel Office ready on http://localhost:${port}`);
  });
});
