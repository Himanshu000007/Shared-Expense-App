// All shared Express middleware in one place: auth guard, body validation,
// and the central error handler.
import { ApiError, verifyToken } from './helpers.js';

// Proves WHO the caller is. Verifies the Bearer JWT and sets req.userId.
// Per-group permission checks live on the feature routes, not here.
export function requireAuth(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(new ApiError(401, 'Missing or malformed Authorization header'));
  }
  try {
    req.userId = verifyToken(token).sub;
    next();
  } catch {
    next(new ApiError(401, 'Invalid or expired token'));
  }
}

// Validate req.body against a zod schema; on success replace body with the
// parsed (trimmed/typed) data, on failure return 400 with the offending fields.
export const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const msg = result.error.issues
      .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
      .join('; ');
    return next(new ApiError(400, msg));
  }
  req.body = result.data;
  next();
};

// Central error translator. ApiError → its status; anything else is a 500.
// eslint-disable-next-line no-unused-vars -- Express needs the 4-arg signature
export function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error('[unhandled]', err);
  return res.status(500).json({ error: 'Internal server error' });
}
