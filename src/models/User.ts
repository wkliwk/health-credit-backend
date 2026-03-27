import mongoose, { Schema, Document } from 'mongoose';

export interface IPushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  pushSubscription?: IPushSubscription;
  createdAt: Date;
  updatedAt: Date;
}

const pushSubscriptionSchema = new Schema<IPushSubscription>(
  {
    endpoint: { type: String, required: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
  },
  { _id: false },
);

const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true },
    pushSubscription: { type: pushSubscriptionSchema, default: undefined },
  },
  { timestamps: true },
);

export const UserModel = mongoose.model<IUser>('User', userSchema);
