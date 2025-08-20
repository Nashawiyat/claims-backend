"use strict";
/**
 * User Controller
 * Administrative & finance operations on users (e.g. adjusting claim limits).
 */

const { User } = require("../models");
const AppError = require('../utils/AppError');
const { Config } = require('../models');
const mongoose = require('mongoose');

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

// GET /api/users/:id/claim-limit (self, admin, finance, manager of employee)
exports.getClaimLimit = async (req, res, next) => {
  try {
    const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) throw AppError.badRequest('Invalid user id','INVALID_USER_ID');
    const target = await User.findById(id);
    if (!target) throw AppError.notFound('User not found');

    // Authorization
    const requester = req.user;
    const isSelf = requester._id.toString() === target._id.toString();
    const elevated = ['admin','finance'].includes(requester.role);
    const managerOf = requester.role === 'manager' && target.manager && target.manager.toString() === requester._id.toString();
    if (!(isSelf || elevated || managerOf)) {
      throw AppError.forbidden('Not authorized to view this claim limit','CLAIM_LIMIT_FORBIDDEN');
    }

    // Compute effective claim limit
    const cfg = await Config.getConfig();
    let source = 'default';
    let effective = cfg.defaultClaimLimit;
    if (target.claimLimit !== null && target.claimLimit !== undefined) {
      effective = target.claimLimit; source = 'override';
    } else if (cfg.roleClaimLimits && cfg.roleClaimLimits.has(target.role)) {
      effective = cfg.roleClaimLimits.get(target.role); source = 'role';
    }

    // Compute used toward limit (exclude drafts & rejected)
    const { Claim } = require('../models');
    const usedAgg = await Claim.aggregate([
      { $match: { user: target._id, status: { $in: ['submitted','approved','reimbursed'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const used = usedAgg.length ? usedAgg[0].total : 0;
    const remaining = Math.max(effective - used, 0);
    return res.json({
      userId: target._id,
      role: target.role,
      claimLimitOverride: target.claimLimit,
      effectiveClaimLimit: effective,
      usedClaimAmount: used,
      remainingClaimLimit: remaining,
      source
    });
  } catch (err) {
    return next(err);
  }
};

// GET /api/users/:id  (self, admin, finance, manager of employee)
exports.getUser = async (req, res, next) => {
  try {
    const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) throw AppError.badRequest('Invalid user id','INVALID_USER_ID');
  const user = await User.findById(id).select('-password');
    if (!user) throw AppError.notFound('User not found');
    const requester = req.user;
    const isSelf = requester._id.toString() === user._id.toString();
    const elevated = ['admin','finance'].includes(requester.role);
    const managerOf = requester.role === 'manager' && user.manager && user.manager.toString() === requester._id.toString();
    if (!(isSelf || elevated || managerOf)) {
      throw AppError.forbidden('Not authorized to view this user','USER_FORBIDDEN');
    }
    return res.json({ user });
  } catch (err) {
    return next(err);
  }
};

// GET /api/users/:id/manager  (self (if employee), admin, finance, manager-of manager itself)
exports.getUserManager = async (req, res, next) => {
  try {
    const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) throw AppError.badRequest('Invalid user id','INVALID_USER_ID');
  const user = await User.findById(id).select('manager role');
    if (!user) throw AppError.notFound('User not found');
    if (user.role !== 'employee') {
      return res.status(400).json({ message: 'User is not an employee and has no manager' });
    }
    const requester = req.user;
    const isSelf = requester._id.toString() === user._id.toString();
    const elevated = ['admin','finance'].includes(requester.role);
    const isManager = requester.role === 'manager' && user.manager && user.manager.toString() === requester._id.toString();
    if (!(isSelf || elevated || isManager)) {
      throw AppError.forbidden('Not authorized to view manager info','MANAGER_INFO_FORBIDDEN');
    }
    if (!user.manager) return res.status(404).json({ message: 'Manager not set' });
    const manager = await User.findById(user.manager).select('name email role');
    if (!manager) return res.status(404).json({ message: 'Manager not found' });
    return res.json({ manager });
  } catch (err) {
    return next(err);
  }
};

// GET /api/users/lookup?email=...  (admin, finance)
// Returns minimal user info by email; used by front-end to decide UI actions (e.g., disallow editing admin limits)
exports.lookupUserByEmail = async (req, res, next) => {
  try {
    const { email } = req.query;
    if (!email || typeof email !== 'string') throw AppError.badRequest('email query parameter required','EMAIL_REQUIRED');
    const normalized = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalized }).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    return res.json({ user });
  } catch (err) {
    return next(err);
  }
};
