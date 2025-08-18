"use strict";
/**
 * Config Controller
 * Admin operations for global configuration (singleton document).
 */

const { Config } = require("../models");

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
