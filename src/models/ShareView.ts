import mongoose, { Schema, Document } from 'mongoose';

export interface IShareView extends Document {
  shareId: mongoose.Types.ObjectId;
  userId: string;
  viewedAt: Date;
  recipientIp: string;
  userAgent: string;
}

const shareViewSchema = new Schema<IShareView>(
  {
    shareId: { type: Schema.Types.ObjectId, ref: 'Share', required: true, index: true },
    userId: { type: String, required: true, index: true },
    viewedAt: { type: Date, default: Date.now, required: true },
    recipientIp: { type: String, required: true },
    userAgent: { type: String, default: '' },
  },
  { timestamps: false },
);

// TTL index — auto-purge view records after 30 days
shareViewSchema.index({ viewedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const ShareViewModel = mongoose.model<IShareView>('ShareView', shareViewSchema);
