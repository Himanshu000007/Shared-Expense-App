// Express app assembly. Mounts middleware, feature routers, then the error
// handler. Separate from server.js so tests can import it without listening.
import express from 'express';
import cors from 'cors';
import authRouter from './auth.js';
import { errorHandler } from './middleware.js';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/auth', authRouter);

  // Error handler must be registered last.
  app.use(errorHandler);

  return app;
}
