import { Router, Response, Request } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { UserModel } from '../models/User';
import { getVapidPublicKey } from '../services/pushNotification';

const router = Router();

// GET /api/push/vapid-public-key — no auth required
router.get('/vapid-public-key', (_req: Request, res: Response) => {
  const publicKey = getVapidPublicKey();
  if (!publicKey) {
    res.status(503).json({ error: 'VAPID public key not configured' });
    return;
  }
  res.json({ publicKey });
});

// POST /api/push/subscribe — save or update push subscription for user
router.post('/subscribe', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { endpoint, keys } = req.body as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };

    if (!endpoint || typeof endpoint !== 'string') {
      res.status(400).json({ error: 'endpoint is required' });
      return;
    }

    if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') {
      res.status(400).json({ error: 'keys.p256dh and keys.auth are required' });
      return;
    }

    const user = await UserModel.findById(req.userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const alreadyExists = user.pushSubscription?.endpoint === endpoint;

    user.pushSubscription = { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
    await user.save();

    res.status(alreadyExists ? 200 : 201).json({ success: true });
  } catch (error) {
    console.error('Subscribe error:', error);
    res.status(500).json({ error: 'Failed to save subscription' });
  }
});

// DELETE /api/push/subscribe — deactivate subscription for user
router.delete('/subscribe', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = await UserModel.findById(req.userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    await UserModel.updateOne({ _id: req.userId }, { $unset: { pushSubscription: '' } });

    res.status(204).send();
  } catch (error) {
    console.error('Unsubscribe error:', error);
    res.status(500).json({ error: 'Failed to remove subscription' });
  }
});

export { router as pushRouter };
