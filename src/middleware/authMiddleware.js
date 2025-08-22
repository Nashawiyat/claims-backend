"use strict";
/**
 * Authentication & Authorization Middleware
 *  - protect: verifies JWT and loads user
 *  - authorize: restricts access to specified roles
 */

const jwt = require("jsonwebtoken");
const { User } = require("../models");

// Protect middleware: validates JWT Bearer token and attaches user to request
exports.protect = async (req, res, next) => {
  try {
    // 1. Acquire raw header defensively (case-insensitive lookups)
    const rawHeader = (req.headers && (req.headers.authorization || req.headers.Authorization))
      || req.get && (req.get('Authorization') || req.get('authorization'))
      || '';
    const header = (rawHeader || '').trim();

    if (!header) {
      return res.status(401).json({ success: false, error: "Missing Authorization header" });
    }

    // 2. Validate Bearer format (case-insensitive)
    if (!/^Bearer\s+/i.test(header)) {
      return res.status(401).json({ success: false, error: "Malformed Authorization header — expected 'Bearer <token>'" });
    }

    // 3. Extract token (split on whitespace)
    const parts = header.split(/\s+/);
    const token = parts[1];
    if (!token) {
      return res.status(401).json({ success: false, error: "Bearer token not found" });
    }

    // 4. Decode (unverified) for debugging only
    let decodedPayload = undefined;
    try { decodedPayload = jwt.decode(token) || undefined; } catch (_) { /* ignore decode errors */ }
    if (process.env.NODE_ENV === 'development') {
      try {
        console.debug('[auth] header seen, token len', token.length, 'payload', {
          sub: decodedPayload?.sub,
            exp: decodedPayload?.exp,
            iat: decodedPayload?.iat
        });
      } catch(_) { /* swallow logging issues */ }
    }

    // 5. Verify token
    const secret = process.env.JWT_SECRET || "changeme";
    let verified;
    try {
      verified = jwt.verify(token, secret);
    } catch (err) {
      if (err && err.name === 'TokenExpiredError') {
        return res.status(401).json({ success: false, error: 'Token expired' });
      }
      return res.status(401).json({ success: false, error: 'Invalid token: ' + (err && err.message ? err.message.split('\n')[0] : 'verification failed') });
    }

    // 6. Load user
    const userId = verified.sub || verified.id || verified._id; // slight flexibility
    req.userId = userId;
    const user = await User.findById(userId);
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, error: "Not authorized: user inactive or not found" });
    }
    req.user = user; // attach full user document

    if (process.env.NODE_ENV === 'development') {
      try { console.debug('[auth] req', req.method, req.originalUrl, 'userId', userId); } catch(_){}
    }

    return next();
  } catch (err) {
    return next(err);
  }
};

// Authorize middleware factory: restricts route to allowed roles
exports.authorize = (...roles) => {
  const allowed = new Set(roles);
  return (req, res, next) => {
    if (!req.user) {
  return res.status(500).json({ success: false, error: "User context missing before authorization" });
    }
  // Admin bypass: admin can do everything
  if (req.user.role === 'admin') return next();
  if (!allowed.has(req.user.role)) {
  return res.status(403).json({ success: false, error: "Forbidden: insufficient role", currentRole: req.user.role });
    }
    next();
  };
};
