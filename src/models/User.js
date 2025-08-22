"use strict";
/**
 * User model
 * Represents application users (employees, managers, finance, admins)
 * Includes password hashing + helper utilities.
 */

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

// Central role definitions for consistency
const ROLES = Object.freeze(["employee", "manager", "finance", "admin"]);

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /[^@\s]+@[^@\s]+\.[^@\s]+/,
      index: true,
    },
    password: { type: String, required: true, minlength: 6 },
    role: {
      type: String,
      enum: ROLES,
      required: true,
      default: "employee",
      index: true,
    },
    manager: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: function () { return this.role === 'employee'; },
    },
    claimLimit: {
      // Personal override; if null, derive from config or role defaults
      type: Number,
      default: null,
      min: 0,
    },
  // Persisted tracking of used claim amount (updated on transitions) for fast queries
  usedClaimAmount: { type: Number, default: 0, min: 0 },
  // Unified total limit (resolved from override/global) cached for reporting (optional periodic recompute)
  claimLimitTotal: { type: Number, default: 0, min: 0 },
  lastClaimResetAt: { type: Date },
    isActive: { type: Boolean, default: true, index: true },
    lastLoginAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function (_doc, ret) {
        delete ret.password;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Index compound for faster lookups (active users by role)
UserSchema.index({ role: 1, isActive: 1 });

// Password hashing
UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  try {
    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || "10", 10);
    const salt = await bcrypt.genSalt(saltRounds);
    this.password = await bcrypt.hash(this.password, salt);
    return next();
  } catch (err) {
    return next(err);
  }
});

// When role changes, only clear manager if new role no longer participates in supervision chain.
// Previously we cleared for any non-employee role which removed supervising manager from managers
// themselves, breaking ability to snapshot their reviewer on claim creation.
UserSchema.pre("save", function (next) {
  if (this.isModified("role")) {
    // Allow both employees and managers to retain a supervising manager reference
    if (!["employee", "manager"].includes(this.role) && this.manager) {
      this.manager = undefined; // finance/admin do not keep manager link
    }
  }
  next();
});

// Instance methods
UserSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

// Static helpers
UserSchema.statics.getRoles = () => ROLES.slice();

module.exports = mongoose.model("User", UserSchema);
module.exports.ROLES = ROLES;
