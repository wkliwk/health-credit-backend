import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { authenticate, AuthRequest } from '../middleware/auth';
import { ShareModel } from '../models/Share';
import { ShareViewModel } from '../models/ShareView';
import { DocumentModel } from '../models/Document';
import { getBlob } from '../services/storage';

const router = Router();

const EXPIRY_OPTIONS: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

// Create share link
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { documentIds, expiry = '24h', maxViews } = req.body;

    if (!documentIds?.length) {
      res.status(400).json({ error: 'documentIds is required' });
      return;
    }

    const expiryMs = EXPIRY_OPTIONS[expiry];
    if (!expiryMs) {
      res.status(400).json({ error: `Invalid expiry. Options: ${Object.keys(EXPIRY_OPTIONS).join(', ')}` });
      return;
    }

    // Verify all documents belong to the user
    const docs = await DocumentModel.find({
      _id: { $in: documentIds },
      userId: req.userId,
    });

    if (docs.length !== documentIds.length) {
      res.status(400).json({ error: 'One or more documents not found or not owned by you' });
      return;
    }

    const share = await ShareModel.create({
      userId: req.userId,
      documentIds,
      expiresAt: new Date(Date.now() + expiryMs),
      maxViews: maxViews || null,
    });

    res.status(201).json({
      id: share._id,
      token: share.token,
      url: `/api/shares/${share.token}`,
      expiresAt: share.expiresAt,
      maxViews: share.maxViews,
      documentCount: documentIds.length,
    });
  } catch (error) {
    console.error('Create share error:', error);
    res.status(500).json({ error: 'Failed to create share link' });
  }
});

// List user's active shares
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const shares = await ShareModel.find({
      userId: req.userId,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    // Fetch lastViewedAt for each share from ShareView collection
    const shareIds = shares.map((s) => s._id);
    const lastViews = await ShareViewModel.aggregate<{ _id: mongoose.Types.ObjectId; lastViewedAt: Date }>([
      { $match: { shareId: { $in: shareIds } } },
      { $sort: { viewedAt: -1 } },
      { $group: { _id: '$shareId', lastViewedAt: { $first: '$viewedAt' } } },
    ]);

    const lastViewMap = new Map<string, Date>(
      lastViews.map((v) => [v._id.toString(), v.lastViewedAt]),
    );

    res.json(
      shares.map((s) => ({
        id: s._id,
        token: s.token,
        url: `/api/shares/${s.token}`,
        documentIds: s.documentIds,
        expiresAt: s.expiresAt,
        maxViews: s.maxViews,
        viewCount: s.viewCount,
        createdAt: s.createdAt,
        lastViewedAt: lastViewMap.get(s._id.toString()) ?? null,
      })),
    );
  } catch (error) {
    console.error('List shares error:', error);
    res.status(500).json({ error: 'Failed to list shares' });
  }
});

// Access shared documents (public — no auth required)
router.get('/:token', async (req: Request, res: Response) => {
  try {
    const share = await ShareModel.findOne({ token: req.params.token });

    if (!share) {
      res.status(404).json({ error: 'Share link not found' });
      return;
    }

    if (share.expiresAt < new Date()) {
      res.status(410).json({ error: 'Share link has expired' });
      return;
    }

    if (share.maxViews && share.viewCount >= share.maxViews) {
      res.status(410).json({ error: 'Share link has reached maximum views' });
      return;
    }

    // Log the view
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const ipHash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
    const userAgent = req.headers['user-agent'] || '';

    share.viewCount += 1;
    share.viewLog.push({ viewedAt: new Date(), ipHash, userAgent });
    await share.save();

    // Fire-and-forget: persist ShareView for audit trail (does not block response)
    ShareViewModel.create({
      shareId: share._id,
      userId: share.userId,
      viewedAt: new Date(),
      recipientIp: crypto.createHash('sha256').update(ip).digest('hex'),
      userAgent: (req.headers['user-agent'] ?? '').substring(0, 128),
    }).catch((err: unknown) => {
      console.error('ShareView create error:', err);
    });

    // Get document metadata (not the blobs — client fetches those separately)
    const docs = await DocumentModel.find(
      { _id: { $in: share.documentIds } },
      { s3Key: 0, userId: 0 },
    );

    res.json({
      documents: docs.map((d) => ({
        id: d._id,
        fileName: d.fileName,
        mimeType: d.mimeType,
        size: d.size,
        encryptionSalt: d.encryptionSalt,
        encryptionIV: d.encryptionIV,
        createdAt: d.createdAt,
      })),
      viewCount: share.viewCount,
      expiresAt: share.expiresAt,
    });
  } catch (error) {
    console.error('Access share error:', error);
    res.status(500).json({ error: 'Failed to access share' });
  }
});

// Get shared document blob (public — no auth, but requires valid share token)
router.get('/:token/documents/:docId', async (req: Request, res: Response) => {
  try {
    const share = await ShareModel.findOne({ token: req.params.token });

    if (!share || share.expiresAt < new Date()) {
      res.status(410).json({ error: 'Share link expired or not found' });
      return;
    }

    if (share.maxViews && share.viewCount > share.maxViews) {
      res.status(410).json({ error: 'Share link has reached maximum views' });
      return;
    }

    const docId = req.params.docId;
    if (!share.documentIds.some((id) => id.toString() === docId)) {
      res.status(403).json({ error: 'Document not included in this share' });
      return;
    }

    const doc = await DocumentModel.findById(docId);
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const { body, contentType } = await getBlob(doc.s3Key);
    if (!body) {
      res.status(500).json({ error: 'Failed to retrieve document' });
      return;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${doc.fileName}"`);

    const reader = body.getReader();
    const pump = async (): Promise<void> => {
      const { done, value } = await reader.read();
      if (done) {
        res.end();
        return;
      }
      res.write(value);
      return pump();
    };
    await pump();
  } catch (error) {
    console.error('Download shared doc error:', error);
    res.status(500).json({ error: 'Failed to retrieve document' });
  }
});

// Get view history for a share (owner only)
router.get('/:shareId/views', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const share = await ShareModel.findById(req.params.shareId);

    if (!share) {
      res.status(404).json({ error: 'Share not found' });
      return;
    }

    if (share.userId.toString() !== req.userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const views = await ShareViewModel.find({ shareId: share._id })
      .sort({ viewedAt: -1 })
      .limit(20)
      .lean();

    // Count unique viewers by distinct hashed IP
    const uniqueIps = await ShareViewModel.distinct('recipientIp', { shareId: share._id });

    res.json({
      shareId: share._id,
      totalViews: share.viewCount,
      uniqueViewers: uniqueIps.length,
      views: views.map((v) => ({
        viewedAt: v.viewedAt,
        userAgent: v.userAgent,
      })),
    });
  } catch (error) {
    console.error('Get share views error:', error);
    res.status(500).json({ error: 'Failed to get share views' });
  }
});

// Revoke share link
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const share = await ShareModel.findOne({ _id: req.params.id, userId: req.userId });
    if (!share) {
      res.status(404).json({ error: 'Share not found' });
      return;
    }

    await ShareModel.deleteOne({ _id: share._id });
    res.status(204).send();
  } catch (error) {
    console.error('Delete share error:', error);
    res.status(500).json({ error: 'Failed to revoke share' });
  }
});

export { router as sharesRouter };
