// Small shared helpers: typed error, JWT sign/verify, public-user shaping.
import jwt from 'jsonwebtoken';

// A typed error carrying an HTTP status. errorHandler turns it into JSON.
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// Env read lazily so dotenv has loaded before first use.
const secret = () => process.env.JWT_SECRET || 'dev-secret-change-me';
const ttl = () => process.env.JWT_TTL || '7d';

export const signToken = (user) =>
  jwt.sign({ sub: user.id, email: user.email }, secret(), { expiresIn: ttl() });

export const verifyToken = (token) => jwt.verify(token, secret());

// Shape a DB row (snake_case) into the public user object. Guarantees
// password_hash never leaves the server.
export const toPublicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  createdAt: u.created_at,
});
