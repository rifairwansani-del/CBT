import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { initDatabase, seedInitialData } from './server/db.ts';
import { createApiRouter } from './server/routes.ts';
import { realtimeHub } from './server/realtime.ts';

async function startServer() {
  initDatabase();
  seedInitialData();

  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  app.set('trust proxy', 1);

  // Security headers & JSON parsing
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());

  // Mount API routes
  app.use('/api', createApiRouter());

  // Create shared HTTP server for Express + WebSockets
  const server = http.createServer(app);
  realtimeHub.attach(server);

  if (process.env.NODE_ENV !== 'production') {
    let viteMiddleware: express.RequestHandler | null = null;
    const viteReady = import('vite')
      .then(({ createServer: createViteServer }) =>
        createViteServer({
          server: {
            middlewareMode: true,
            hmr: false,
          },
          appType: 'spa',
        })
      )
      .then((vite) => {
        viteMiddleware = vite.middlewares;
      });
    viteReady.catch((err) => {
      console.error('Failed to initialize Vite dev middleware:', err);
    });
    app.use(async (req, res, next) => {
      try {
        if (!viteMiddleware) {
          await viteReady;
        }
        return viteMiddleware!(req, res, next);
      } catch (err) {
        return next(err);
      }
    });
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir, { maxAge: '1d' }));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`SinarCBT server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start SinarCBT server:', err);
  process.exit(1);
});
