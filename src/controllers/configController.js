"use strict";
/**
 * Config Controller
 * Admin operations for global configuration (singleton document).
 */

const { Config, User } = require("../models");

// PATCH /api/config  (admin only)
// Body: { defaultClaimLimit: number }
exports.updateConfig = async (req, res, next) => {
  try {
    const { defaultClaimLimit } = req.body;
    if (defaultClaimLimit === undefined) {
      return res.status(400).json({ message: "defaultClaimLimit is required" });
    }
    const numeric = Number(defaultClaimLimit);
    if (!Number.isFinite(numeric) || numeric < 0) {
      return res.status(400).json({ message: "defaultClaimLimit must be a non-negative number" });
    }
    const cfg = await Config.getConfig();
    cfg.defaultClaimLimit = numeric;
    cfg.updatedBy = req.user._id;
    await cfg.save();
    return res.json({ config: cfg });
  } catch (err) {
    return next(err);
  }
};

// PUT /api/config/default-limit  (finance, admin)
// Body: { defaultLimit:number }
exports.setDefaultLimit = async (req, res, next) => {
  try {
    const { defaultLimit } = req.body;
    if (defaultLimit === undefined) {
      return res.status(400).json({ message: 'defaultLimit is required' });
    }
    const numeric = Number(defaultLimit);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return res.status(400).json({ message: 'defaultLimit must be a positive number' });
    }
    const cfg = await Config.getConfig();
    cfg.defaultClaimLimit = numeric;
    cfg.updatedBy = req.user._id;
    await cfg.save();
    return res.json({ config: cfg });
  } catch (err) {
    return next(err);
  }
};

// PUT /api/config/user-limit  (finance, admin)
// Body: { email:string, limit:number, used:number }
// Note: existing schema has plain claimLimit override (total). 'used' is not tracked separately in user; include basic validation and echo back.
exports.setUserLimit = async (req, res, next) => {
  try {
    const { email, limit, used } = req.body;
    if (!email) return res.status(400).json({ message: 'email is required' });
    if (limit === undefined) return res.status(400).json({ message: 'limit is required' });
    if (used === undefined) return res.status(400).json({ message: 'used is required' });
    const totalNum = Number(limit);
    const usedNum = Number(used);
    if (!Number.isFinite(totalNum) || totalNum <= 0) {
      return res.status(400).json({ message: 'limit must be a positive number' });
    }
    if (!Number.isFinite(usedNum) || usedNum < 0) {
      return res.status(400).json({ message: 'used must be a non-negative number' });
    }
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.claimLimit = totalNum; // override total limit
    await user.save();
    // 'used' not persisted separately (aggregate from claims); return echo for front-end alignment
    return res.json({ user: user.toJSON(), used: usedNum });
  } catch (err) {
    return next(err);
  }
};
