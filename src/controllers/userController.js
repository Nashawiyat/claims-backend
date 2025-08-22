"use strict";
/**
 * User Controller
 * Administrative & finance operations on users (e.g. adjusting claim limits).
 */

const { User } = require("../models");
const { success } = require('../utils/apiResponse');
const AppError = require('../utils/AppError');
const { Config } = require('../models');
const mongoose = require('mongoose');
const { Claim } = require('../models');

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
  return res.json(success({ user: user.toJSON() }));
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
  return res.json(success({ user: user.toJSON() }));
  } catch (err) {
    return next(err);
  }
};

// GET /api/users/managers  (public for registration UI or could restrict)
exports.listManagers = async (_req, res, next) => {
  try {
    const managers = await User.find({ role: 'manager', isActive: true }, { name: 1, email: 1 }).sort({ name: 1 });
  return res.json(success({ managers }));
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

  // Use persisted usage counter (respects manual resets) instead of aggregating claims each time
  const used = target.usedClaimAmount || 0;
  const remaining = Math.max(effective - used, 0);
    return res.json(success({
      userId: target._id,
      role: target.role,
      claimLimitOverride: target.claimLimit,
      effectiveClaimLimit: effective,
      usedClaimAmount: used,
      remainingClaimLimit: remaining,
      source
    }));
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
  return res.json(success({ user }));
  } catch (err) {
    return next(err);
  }
};

// GET /api/users/:id/manager  (self (if employee or manager), admin, finance, supervising manager)
exports.getUserManager = async (req, res, next) => {
  try {
    const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) throw AppError.badRequest('Invalid user id','INVALID_USER_ID');
  const user = await User.findById(id).select('manager role');
    if (!user) throw AppError.notFound('User not found');
    // Support both employees and managers having supervising managers. Finance/Admin do not.
    if (!['employee','manager'].includes(user.role)) {
      return res.status(400).json({ message: 'User role does not have a supervising manager' });
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
  return res.json(success({ manager }));
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
  return res.json(success({ user }));
  } catch (err) {
    return next(err);
  }
};

// ADMIN: list users with pagination basic
exports.listUsers = async (req, res, next) => {
  try {
    const { page=1, limit=50 } = req.query;
    const p = Math.max(parseInt(page,10)||1,1);
    const l = Math.min(Math.max(parseInt(limit,10)||50,1),100);
    const [items,total] = await Promise.all([
      User.find({}, 'name email role manager usedClaimAmount claimLimit').populate('manager','name email').skip((p-1)*l).limit(l),
      User.countDocuments()
    ]);
    return res.json(success({ items, page:p, limit:l, totalItems: total, totalPages: Math.ceil(total/l)||1 }));
  } catch (err) { return next(err); }
};

// ADMIN: create user
exports.createUser = async (req, res, next) => {
  try {
  const { name, email, password, role='employee', supervisingManager, manager } = req.body;
  if (!name || !email || !password) return res.status(400).json({ success:false, error:'name, email, password required' });
  if (password.length < 8) return res.status(400).json({ success:false, error:'password must be at least 8 characters' });
    if (await User.findOne({ email: email.toLowerCase() })) return res.status(409).json({ success:false, error:'Email already exists' });
    let managerId = manager || supervisingManager; // accept either field name
  if (role === 'employee' && !managerId) return res.status(400).json({ success:false, error:'supervisingManager required for role employee' });
    if (managerId) {
      if (!mongoose.Types.ObjectId.isValid(managerId)) return res.status(400).json({ success:false, error:'Invalid supervisingManager id' });
      const mgr = await User.findById(managerId);
      if (!mgr || mgr.role !== 'manager') return res.status(400).json({ success:false, error:'supervisingManager must be an existing manager' });
    }
    // Seed claimLimit ONLY at creation time (future accounts) using new structured defaults if available
    let seedClaimLimit = undefined;
    const { Config } = require('../models');
    const cfg = await Config.getConfig();
    if (cfg && cfg.defaultLimits && cfg.defaultLimits[role] != null) {
      seedClaimLimit = cfg.defaultLimits[role];
    }
    const user = await User.create({ name, email, password, role, manager: managerId, claimLimit: seedClaimLimit });
    return res.status(201).json(success({ user }));
  } catch (err) { return next(err); }
};

// ADMIN: update user
exports.updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role, supervisingManager, manager, password } = req.body;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ success:false, error:'User not found' });
    if (role) user.role = role;
    let managerId = manager || supervisingManager;
    if (password !== undefined) {
      if (!password) return res.status(400).json({ success:false, error:'password cannot be empty' });
      if (password.length < 8) return res.status(400).json({ success:false, error:'password must be at least 8 characters' });
      user.password = password; // pre-save hook will hash
    }
    if (user.role === 'employee' || user.role === 'manager') {
      if (user.role === 'employee' && !managerId && !user.manager) return res.status(400).json({ success:false, error:'supervisingManager required for role employee' });
      if (managerId) {
        if (!mongoose.Types.ObjectId.isValid(managerId)) return res.status(400).json({ success:false, error:'Invalid supervisingManager id' });
        const mgr = await User.findById(managerId);
        if (!mgr || mgr.role !== 'manager') return res.status(400).json({ success:false, error:'supervisingManager must be an existing manager' });
        user.manager = managerId;
      }
    } else if (managerId) { // setting manager for non-employee not allowed
      return res.status(400).json({ success:false, error:'Only employees have supervisingManager' });
    }
    await user.save();
    return res.json(success({ user }));
  } catch (err) { return next(err); }
};

// ADMIN: delete user (cascade delete claims; reassign subordinates if manager)
exports.deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (req.user._id.toString() === id) return res.status(400).json({ success:false, error:'Cannot delete self' });
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ success:false, error:'User not found' });

    // If deleting a manager, reassign all direct reports (employees or managers) to another manager
    if (user.role === 'manager') {
      const replacement = await User.findOne({ _id: { $ne: user._id }, role: 'manager', isActive: true }).sort({ createdAt: 1 });
      const subCount = await User.countDocuments({ manager: user._id });
      if (subCount > 0) {
        if (!replacement) {
          return res.status(400).json({ success:false, error:'Cannot delete manager with subordinates until another manager exists for reassignment' });
        }
        await User.updateMany({ manager: user._id }, { $set: { manager: replacement._id } });
      }
    }

    // Cascade delete this user's claims (all statuses)
    await Claim.deleteMany({ user: user._id });

    await user.deleteOne();
    return res.json(success({ deleted: true }));
  } catch (err) { return next(err); }
};

// CLAIM LIMITS aggregate list
exports.listClaimLimits = async (req, res, next) => {
  try {
    const users = await User.find({}, 'name email role usedClaimAmount claimLimit claimLimitTotal');
    // Pull global config once to derive effective default when no override or cached total present
    const { Config } = require('../models');
    const cfg = await Config.getConfig();
    const data = users.map(u => {
      let total;
      if (u.claimLimit !== null && u.claimLimit !== undefined) {
        total = u.claimLimit; // explicit override (created/edited user)
      } else if (u.claimLimitTotal) {
        total = u.claimLimitTotal; // cached historic total
      } else if (cfg.roleClaimLimits && cfg.roleClaimLimits.has(u.role)) {
        // Legacy per-role limits still apply to pre-existing accounts
        total = cfg.roleClaimLimits.get(u.role);
      } else {
        // Do NOT apply new defaultLimits retroactively; fall back to legacy global default
        total = cfg.defaultClaimLimit;
      }
      const used = u.usedClaimAmount || 0;
      return {
        _id: u._id,
        name: u.name,
        email: u.email,
        role: u.role,
        limit: { total },
        used,
        remaining: Math.max((total || 0) - used, 0)
      };
    });
    return res.json(success({ items: data }));
  } catch (err) { return next(err); }
};

// Update specific user claim limit total & optional reset / recompute
exports.updateClaimLimitTotal = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { total, resetUsed, recomputeUsed } = req.body;
    if (total === undefined) return res.status(400).json({ success:false, error:'total required' });
    const numeric = Number(total);
    if (!Number.isFinite(numeric) || numeric < 0) return res.status(400).json({ success:false, error:'total must be non-negative number' });
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success:false, error:'User not found' });
    user.claimLimit = numeric; // override total limit (authoritative)
    if (resetUsed) user.usedClaimAmount = 0; // manual reset
    await user.save();
    // Optional recompute (after save so override persists)
    if (recomputeUsed) {
      const { recomputeUsed: recompute } = require('../services/claimsUsage');
      await recompute(user._id);
      await user.reload();
    }
    const totalLimit = user.claimLimit;
    const remaining = Math.max((totalLimit || 0) - (user.usedClaimAmount || 0),0);
    return res.json(success({ user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      limit: { total: totalLimit },
      used: user.usedClaimAmount,
      remaining
    }}));
  } catch (err) { return next(err); }
};

exports.recomputeClaimUsage = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { recomputeUsedForUser } = require('../services/claimsUsage');
    const total = await recomputeUsedForUser(userId);
    const user = await User.findById(userId).select('usedClaimAmount');
    return res.json(success({ userId, usedClaimAmount: total }));
  } catch (err) { return next(err); }
};

// BULK: apply current config default limit to all users of a role
// POST /api/users/claim-limits/apply-defaults  { role }
exports.applyRoleDefaultLimits = async (req, res, next) => {
  try {
    const { role } = req.body || {};
    const allowedRoles = ['employee','manager','admin'];
    if (!role || !allowedRoles.includes(role)) return res.status(400).json({ success:false, error:'Invalid or missing role' });
    const isAdmin = req.user.role === 'admin';
    if (role === 'admin' && !isAdmin) return res.status(403).json({ success:false, error:'Only admin can bulk update admin role limits' });
    if (!isAdmin && !['employee','manager'].includes(role)) return res.status(403).json({ success:false, error:'Not authorized for this role' });
    const { Config } = require('../models');
    const cfg = await Config.getConfig();
    // Determine target total from structured defaults or legacy maps
    let newTotal = undefined;
    if (cfg.defaultLimits && cfg.defaultLimits[role] != null) newTotal = cfg.defaultLimits[role];
    else if (cfg.roleClaimLimits && cfg.roleClaimLimits.has(role)) newTotal = cfg.roleClaimLimits.get(role);
    else newTotal = cfg.defaultClaimLimit;
    // Update only users whose claimLimit differs (or is null/undefined)
    const result = await User.updateMany({ role }, { $set: { claimLimit: newTotal } });
    return res.json(success({ role, newTotal, matched: result.matchedCount, modified: result.modifiedCount }));
  } catch (err) { return next(err); }
};

// BULK: reset usedClaimAmount for all users (optionally by role)
// POST /api/users/claim-limits/reset-used-all { role? }
exports.resetAllUsed = async (req, res, next) => {
  try {
    const { role } = req.body || {};
    const filter = {};
    if (role) {
      const allowedRoles = ['employee','manager','admin','finance'];
      if (!allowedRoles.includes(role)) return res.status(400).json({ success:false, error:'Invalid role filter' });
      filter.role = role;
    }
    const result = await User.updateMany(filter, { $set: { usedClaimAmount: 0 } });
    return res.json(success({ role: role || 'all', reset: result.modifiedCount }));
  } catch (err) { return next(err); }
};
