"use strict";
/**
 * User Controller
 * Administrative & finance operations on users (e.g. adjusting claim limits).
 */

const { User } = require("../models");

// PATCH /api/users/:id/limit  (admin, finance)
// Body: { claimLimit: <number|null> }
exports.updateClaimLimit = async (req, res, next) => {
  try {
    const { id } = req.params;
    let { claimLimit } = req.body;
    if (claimLimit === undefined) {
      return res.status(400).json({ message: "claimLimit is required (number or null)" });
    }
    if (claimLimit === null || claimLimit === "null") {
      claimLimit = null; // explicit reset to use global default
    } else {
      const numeric = Number(claimLimit);
      if (!Number.isFinite(numeric) || numeric < 0) {
        return res.status(400).json({ message: "claimLimit must be a non-negative number or null" });
      }
      claimLimit = numeric;
    }
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });
    user.claimLimit = claimLimit;
    await user.save();
    return res.json({ user: user.toJSON() });
  } catch (err) {
    return next(err);
  }
};
