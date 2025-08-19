"use strict";
/**
 * User Controller
 * Administrative & finance operations on users (e.g. adjusting claim limits).
 */

const { User } = require("../models");
const AppError = require('../utils/AppError');

// PATCH /api/users/:id/limit  (admin, finance)
// Body: { claimLimit: <number|null> }
exports.updateClaimLimit = async (req, res, next) => {
  try {
    const { id } = req.params;
    let { claimLimit } = req.body;
  if (claimLimit === undefined) throw AppError.badRequest('claimLimit is required', 'CLAIM_LIMIT_REQUIRED');
    if (claimLimit === null || claimLimit === "null") {
      claimLimit = null; // explicit reset to use global default
    } else {
      const numeric = Number(claimLimit);
      if (!Number.isFinite(numeric) || numeric < 0) {
        throw AppError.badRequest('claimLimit must be a non-negative number or null', 'CLAIM_LIMIT_INVALID');
      }
      claimLimit = numeric;
    }
    const user = await User.findById(id);
  if (!user) throw AppError.notFound('User not found');
    user.claimLimit = claimLimit;
    await user.save();
    return res.json({ user: user.toJSON() });
  } catch (err) {
    return next(err);
  }
};

// PATCH /api/users/:id/manager (admin only)
// Body: { managerId: ObjectId | null }
exports.updateManager = async (req, res, next) => {
  try {
    const { id } = req.params;
    let { managerId } = req.body;
    const user = await User.findById(id);
  if (!user) throw AppError.notFound('User not found');
  if (user.role !== 'employee') throw AppError.badRequest('Only employees have managers','NOT_EMPLOYEE');
  if (managerId === null || managerId === 'null') throw AppError.badRequest('Employee must have a manager','MANAGER_REQUIRED');
  if (!managerId) throw AppError.badRequest('managerId required','MANAGER_ID_REQUIRED');
    const manager = await User.findById(managerId);
  if (!manager || manager.role !== 'manager') throw AppError.badRequest('managerId must reference a manager user','MANAGER_INVALID');
    user.manager = manager._id;
    await user.save();
    return res.json({ user: user.toJSON() });
  } catch (err) {
    return next(err);
  }
};

// GET /api/users/managers  (public for registration UI or could restrict)
exports.listManagers = async (_req, res, next) => {
  try {
    const managers = await User.find({ role: 'manager', isActive: true }, { name: 1, email: 1 }).sort({ name: 1 });
    return res.json({ managers });
  } catch (err) {
    return next(err);
  }
};
