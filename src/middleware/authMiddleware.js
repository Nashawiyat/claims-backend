"use strict";
/**
 * Authentication & Authorization Middleware
 *  - protect: verifies JWT and loads user
 *  - authorize: restricts access to specified roles
 */

const jwt = require("jsonwebtoken");
const { User } = require("../models");

// Extract token from Authorization header (Bearer <token>)
function getTokenFromReq(req) {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
    token = req.headers.authorization.substring(7).trim();
  }
  return token;
}

// Protect middleware: validates JWT token and attaches user to request
exports.protect = async (req, res, next) => {
  try {
    const token = getTokenFromReq(req);
    if (!token) {
      return res.status(401).json({ message: "Not authorized: missing token" });
    }
    const secret = process.env.JWT_SECRET || "changeme";
    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch (err) {
      return res.status(401).json({ message: "Not authorized: invalid token" });
    }

    const user = await User.findById(decoded.sub);
    if (!user || !user.isActive) {
      return res.status(401).json({ message: "Not authorized: user inactive or not found" });
    }

    req.user = user; // attach full user document
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
      return res.status(500).json({ message: "User context missing before authorization" });
    }
  // Admin bypass: admin can do everything
  if (req.user.role === 'admin') return next();
  if (!allowed.has(req.user.role)) {
      return res.status(403).json({ message: "Forbidden: insufficient role", currentRole: req.user.role });
    }
    next();
  };
};
