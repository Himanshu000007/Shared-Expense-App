// Express app assembly. Mounts middleware, feature routers, then the error
// handler. Separate from server.js so tests can import it without listening.
import express from 'express';
import cors from 'cors';
import authRouter from './auth.js';
import groupsRouter from './groups.js';
import expensesRouter from './expenses.js';
import settlementsRouter from './settlements.js';
import balancesRouter from './balances.js';
import importRouter from './import.js';
import { errorHandler } from './middleware.js';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

  app.use('/api/auth', authRouter);
  app.use('/api/groups', groupsRouter);
  // expenses, settlements and balances declare their own /groups/:id/... and
  // /expenses/... paths, so they mount at /api.
  app.use('/api', expensesRouter);
  app.use('/api', settlementsRouter);
  app.use('/api', balancesRouter);
  app.use('/api', importRouter);

  // Error handler must be registered last.
  app.use(errorHandler);

  return app;
}
