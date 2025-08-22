"use strict";
/**
 * Config Controller
 * Admin operations for global configuration (singleton document).
 */

const { Config, User, ConfigHistory } = require("../models");

// GET /api/config  (finance, admin)
exports.getConfig = async (req, res, next) => {
  try {
    const cfg = await Config.getConfig();
    return res.json({ config: cfg });
  } catch (err) { return next(err); }
};

// PUT /api/config  (finance, admin)
// Body can include: { defaultLimits:{ employee, manager, admin }, resetPolicy:{ cycle, resetDate } }
// Validation rules: admin limit editable only by admin; employee/manager by finance or admin; finance limit not supported.
exports.putConfig = async (req, res, next) => {
  try {
    const { defaultLimits, resetPolicy } = req.body || {};
    const cfg = await Config.getConfig();
    const before = cfg.toObject();
    const isAdmin = req.user.role === 'admin';
    const isFinance = req.user.role === 'finance';

    // Update default limits
    if (defaultLimits) {
      const allowedRoles = ['employee','manager'];
      if (defaultLimits.employee !== undefined) {
        if (!(isAdmin || isFinance)) return res.status(403).json({ message: 'Not authorized to edit employee default limit' });
        const v = Number(defaultLimits.employee); if (!Number.isFinite(v) || v < 0) return res.status(400).json({ message: 'Employee default limit must be non-negative number' });
        cfg.defaultLimits.employee = v;
      }
      if (defaultLimits.manager !== undefined) {
        if (!(isAdmin || isFinance)) return res.status(403).json({ message: 'Not authorized to edit manager default limit' });
        const v = Number(defaultLimits.manager); if (!Number.isFinite(v) || v < 0) return res.status(400).json({ message: 'Manager default limit must be non-negative number' });
        cfg.defaultLimits.manager = v;
      }
      if (defaultLimits.admin !== undefined) {
        if (!isAdmin) return res.status(403).json({ message: 'Only admin can edit admin default limit' });
        const v = Number(defaultLimits.admin); if (!Number.isFinite(v) || v < 0) return res.status(400).json({ message: 'Admin default limit must be non-negative number' });
        cfg.defaultLimits.admin = v;
      }
      // Finance default ignored if provided
    }

    if (resetPolicy) {
      if (!(isAdmin || isFinance)) return res.status(403).json({ message: 'Not authorized to edit reset policy' });
      const { cycle, resetDate } = resetPolicy;
      if (cycle !== undefined) {
        const allowed = ['annual','quarterly','monthly'];
        if (!allowed.includes(cycle)) return res.status(400).json({ message: 'Invalid reset policy cycle' });
        cfg.resetPolicy.cycle = cycle;
      }
      if (resetDate !== undefined) {
        const d = new Date(resetDate);
        if (isNaN(d.getTime())) return res.status(400).json({ message: 'Invalid resetDate' });
        cfg.resetPolicy.resetDate = d;
      }
    }

    cfg.updatedBy = req.user._id;
    await cfg.save();
    await ConfigHistory.create({ before, after: cfg.toObject(), updatedBy: req.user._id });
    return res.json({ config: cfg });
  } catch (err) { return next(err); }
};

// LEGACY: PUT /api/config/default-limit  (finance, admin)
// Kept for backwards compatibility; delegates to new putConfig shape.
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
  // Map to new structure (employee baseline as legacy global)
  req.body = { defaultLimits: { employee: numeric } };
  return exports.putConfig(req, res, next);
  } catch (err) {
    return next(err);
  }
};

// LEGACY: PUT /api/config/user-limit  (finance, admin)
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
