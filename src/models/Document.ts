import mongoose, { Schema, Document as MongoDocument } from 'mongoose';

export interface IDocument extends MongoDocument {
  userId: string;
  fileName: string;
  mimeType: string;
  size: number;
  s3Key: string;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const documentSchema = new Schema<IDocument>(
  {
    userId: { type: String, required: true, index: true },
    fileName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    s3Key: { type: String, required: true },
    expiresAt: { type: Date, default: null, index: true },
  },
  { timestamps: true },
);

// TTL index for auto-deletion
documentSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const DocumentModel = mongoose.model<IDocument>('Document', documentSchema);
