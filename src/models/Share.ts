import mongoose, { Schema, Document } from 'mongoose';
import crypto from 'crypto';

export interface IViewLogEntry {
  viewedAt: Date;
  ipHash: string;
  userAgent: string;
}

export interface IShare extends Document {
  userId: string;
  documentIds: mongoose.Types.ObjectId[];
  token: string;
  expiresAt: Date;
  maxViews: number | null;
  viewCount: number;
  viewLog: IViewLogEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const viewLogSchema = new Schema<IViewLogEntry>(
  {
    viewedAt: { type: Date, default: Date.now },
    ipHash: { type: String, required: true },
    userAgent: { type: String, default: '' },
  },
  { _id: false },
);

const shareSchema = new Schema<IShare>(
  {
    userId: { type: String, required: true, index: true },
    documentIds: [{ type: Schema.Types.ObjectId, ref: 'Document', required: true }],
    token: {
      type: String,
      required: true,
      unique: true,
      default: () => crypto.randomBytes(32).toString('base64url'),
    },
    expiresAt: { type: Date, required: true, index: true },
    maxViews: { type: Number, default: null },
    viewCount: { type: Number, default: 0 },
    viewLog: [viewLogSchema],
  },
  { timestamps: true },
);

// TTL index for auto-cleanup of expired shares
shareSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ShareModel = mongoose.model<IShare>('Share', shareSchema);
