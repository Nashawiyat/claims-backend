"use strict";
/**
 * Config model
 * Holds global application settings (singleton usage pattern).
 */

const mongoose = require("mongoose");

const ConfigSchema = new mongoose.Schema(
  {
    defaultClaimLimit: { type: Number, required: true, default: 1000, min: 0 },
    roleClaimLimits: {
      type: Map,
      of: { type: Number, min: 0 },
      default: {},
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// Ensure only a small number of config docs (soft enforcement)
ConfigSchema.index({ createdAt: 1 });

// Static: fetch or initialize config
ConfigSchema.statics.getConfig = async function () {
  let cfg = await this.findOne();
  if (!cfg) {
    cfg = await this.create({});
  }
  return cfg;
};

// Static: resolve effective claim limit for a given user object
ConfigSchema.statics.getEffectiveClaimLimit = async function (user) {
  if (!user) throw new Error("User required to determine claim limit");
  if (user.claimLimit !== null && user.claimLimit !== undefined) return user.claimLimit;
  const cfg = await this.getConfig();
  if (cfg.roleClaimLimits && cfg.roleClaimLimits.has(user.role)) {
    return cfg.roleClaimLimits.get(user.role);
  }
  return cfg.defaultClaimLimit;
};

module.exports = mongoose.model("Config", ConfigSchema);
