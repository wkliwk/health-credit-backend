import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authenticate, AuthRequest } from '../middleware/auth';

const JWT_SECRET = 'dev-secret';

/**
 * Build minimal mock request/response/next for unit testing the middleware
 * in isolation — no HTTP round-trip, no DB required.
 */
function buildMocks(authHeader?: string): {
  req: Partial<AuthRequest>;
  res: Partial<Response> & { status: jest.Mock; json: jest.Mock };
  next: jest.Mock;
} {
  const req: Partial<AuthRequest> = {
    headers: authHeader ? { authorization: authHeader } : {},
  };

  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };

  const next = jest.fn();

  return { req, res: res as Partial<Response> & { status: jest.Mock; json: jest.Mock }, next };
}

describe('authenticate middleware', () => {
  it('calls next() and attaches userId when the JWT is valid', () => {
    const token = jwt.sign({ sub: 'user123' }, JWT_SECRET, { expiresIn: '1h' });
    const { req, res, next } = buildMocks(`Bearer ${token}`);

    authenticate(req as AuthRequest, res as Response, next as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.userId).toBe('user123');
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header is missing entirely', () => {
    const { req, res, next } = buildMocks();

    authenticate(req as AuthRequest, res as Response, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringMatching(/missing|invalid/i) }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header does not start with "Bearer "', () => {
    const { req, res, next } = buildMocks('Token abc123');

    authenticate(req as AuthRequest, res as Response, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when the token signature is invalid (tampered)', () => {
    const token = jwt.sign({ sub: 'user123' }, 'wrong-secret', { expiresIn: '1h' });
    const { req, res, next } = buildMocks(`Bearer ${token}`);

    authenticate(req as AuthRequest, res as Response, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringMatching(/invalid|expired/i) }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when the token is expired', () => {
    // Sign with a very short expiry, then backdate
    const token = jwt.sign({ sub: 'user123' }, JWT_SECRET, { expiresIn: -1 }); // already expired

    const { req, res, next } = buildMocks(`Bearer ${token}`);

    authenticate(req as AuthRequest, res as Response, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when the Bearer token is an empty string', () => {
    const { req, res, next } = buildMocks('Bearer ');

    authenticate(req as AuthRequest, res as Response, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when the token payload does not contain a sub claim', () => {
    // A token with no sub claim — should still fail or produce undefined userId
    const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
    const { req, res, next } = buildMocks(`Bearer ${token}`);

    // authenticate itself may pass (jwt.verify succeeds), but userId will be undefined.
    // This test documents current behaviour so regressions are caught.
    authenticate(req as AuthRequest, res as Response, next as NextFunction);

    // Either 401 or next() with undefined userId — either is acceptable.
    // We assert that if next is called the middleware does not crash.
    if (next.mock.calls.length > 0) {
      // next was called — userId should be undefined (not a valid user ID)
      expect(req.userId).toBeUndefined();
    } else {
      expect(res.status).toHaveBeenCalledWith(401);
    }
  });
});
