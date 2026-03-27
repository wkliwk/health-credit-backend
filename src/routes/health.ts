import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';

const healthRouter = Router();

healthRouter.get('/', (_req: Request, res: Response) => {
  const dbState = mongoose.connection.readyState;
  const dbStatus = dbState === 1 ? 'connected' : 'disconnected';

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: dbStatus,
    uptime: process.uptime(),
  });
});

export { healthRouter };
