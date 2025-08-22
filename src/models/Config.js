"use strict";
/**
 * Config model
 * Holds global application settings (singleton usage pattern).
 */

const mongoose = require("mongoose");

const ResetPolicySchema = new mongoose.Schema({
  cycle: { type: String, enum: ['annual','quarterly','monthly'], default: 'annual' },
  resetDate: { type: Date, default: () => new Date(new Date().getFullYear(),0,1) } // default Jan 1 this year
},{ _id:false })

const ConfigSchema = new mongoose.Schema({
  // Legacy fields (retain for backwards compatibility & effective limit resolution)
  defaultClaimLimit: { type: Number, required: true, default: 500, min: 0 },
  roleClaimLimits: {
    type: Map,
    of: { type: Number, min: 0 },
    default: {},
  },
  // New structured default limits (future accounts only)
  defaultLimits: {
    employee: { type: Number, default: 500, min: 0 },
    manager: { type: Number, default: 800, min: 0 },
    admin: { type: Number, default: 1000, min: 0 }
  },
  resetPolicy: { type: ResetPolicySchema, default: () => ({}) },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
},{ timestamps: true });

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

// History model for auditing config changes
const ConfigHistorySchema = new mongoose.Schema({
  before: { type: Object, required: true },
  after: { type: Object, required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

module.exports.ConfigHistory = mongoose.model('ConfigHistory', ConfigHistorySchema);
