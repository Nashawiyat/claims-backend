"use strict";
/**
 * Auth Controller
 * Handles user registration and login.
 */

const jwt = require("jsonwebtoken");
const { User } = require("../models");

// Helper to sign JWT
function signToken(user) {
  const secret = process.env.JWT_SECRET || "changeme"; // (warn in logs if default)
  if (secret === "changeme") {
    console.warn("⚠️  Using default JWT secret. Set JWT_SECRET in environment.");
  }
  const payload = {
    sub: user._id.toString(),
    role: user.role,
  };
  const options = {
    expiresIn: process.env.JWT_EXPIRES || "1d",
  };
  return jwt.sign(payload, secret, options);
}

// Sanitize user output
function buildAuthResponse(user) {
  const token = signToken(user);
  return {
    token,
    user: user.toJSON(),
  };
}

// POST /api/auth/register
exports.register = async (req, res, next) => {
  try {
    const { name, email, password, role, manager, claimLimit } = req.body;

    // Basic validation
    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email and password are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    // Check existing
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ message: "Email already registered" });
    }

    // Create user (password hashing handled by model pre-save hook)
    const user = await User.create({
      name,
      email,
      password,
      role: role || undefined,
      manager: manager || undefined,
      claimLimit: claimLimit !== undefined ? claimLimit : undefined,
    });

    return res.status(201).json(buildAuthResponse(user));
  } catch (err) {
    return next(err);
  }
};

// POST /api/auth/login
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email: email.toLowerCase(), isActive: true });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const match = await user.comparePassword(password);
    if (!match) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    user.lastLoginAt = new Date();
    await user.save();

    return res.json(buildAuthResponse(user));
  } catch (err) {
    return next(err);
  }
};
