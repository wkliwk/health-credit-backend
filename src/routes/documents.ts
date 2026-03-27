import { Router, Response } from 'express';
import multer from 'multer';
import { authenticate, AuthRequest } from '../middleware/auth';
import { DocumentModel } from '../models/Document';
import { uploadBlob, getBlob, deleteBlob } from '../services/storage';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Upload encrypted document
router.post('/', authenticate, upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    const s3Key = await uploadBlob(req.file.buffer, req.file.mimetype);

    const retentionDays = req.body.retentionDays ? parseInt(req.body.retentionDays, 10) : null;
    const expiresAt = retentionDays
      ? new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000)
      : undefined;

    const doc = await DocumentModel.create({
      userId: req.userId,
      fileName: req.body.fileName || req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      s3Key,
      expiresAt,
    });

    res.status(201).json({
      id: doc._id,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      size: doc.size,
      createdAt: doc.createdAt,
      expiresAt: doc.expiresAt,
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// List user's documents (metadata only)
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const docs = await DocumentModel.find(
      { userId: req.userId },
      { s3Key: 0 },
    ).sort({ createdAt: -1 });

    res.json(docs.map((d) => ({
      id: d._id,
      fileName: d.fileName,
      mimeType: d.mimeType,
      size: d.size,
      createdAt: d.createdAt,
      expiresAt: d.expiresAt,
    })));
  } catch (error) {
    console.error('List error:', error);
    res.status(500).json({ error: 'Failed to list documents' });
  }
});

// Get single document (encrypted blob)
router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const doc = await DocumentModel.findOne({ _id: req.params.id, userId: req.userId });
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
    console.error('Download error:', error);
    res.status(500).json({ error: 'Failed to retrieve document' });
  }
});

// Delete document
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const doc = await DocumentModel.findOne({ _id: req.params.id, userId: req.userId });
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    await deleteBlob(doc.s3Key);
    await DocumentModel.deleteOne({ _id: doc._id });

    res.status(204).send();
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

export { router as documentsRouter };
