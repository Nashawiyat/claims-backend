"use strict";
/**
 * Claim Controller
 * Handles creation and workflow transitions for claims.
 */

const path = require("path");
const fs = require("fs");
const { Claim, Config, User } = require("../models");
const { success } = require('../utils/apiResponse');
const { paginate } = require('../services/pagination');
const { incrementUsed, decrementUsed, recomputeUsedForUser } = require('../services/claimsUsage');

// Helper: ensure a manager is the direct manager of the claim's employee
async function ensureManagerOf(claim, managerId) {
  if (!claim.populated('user')) {
    await claim.populate('user', 'manager');
  }
  const user = claim.user;
  if (!user) return false;
  return !!(user.manager && user.manager.toString() === managerId.toString());
}

// Ensure uploads directory exists (defensive)
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Create draft claim (employee)
exports.createClaim = async (req, res, next) => {
  try {
  const { title, amount, description, submit } = req.body;
    if (!title || !amount) {
  return res.status(400).json({ success:false, error: "Title and amount are required" });
    }
    const numericAmount = Number(amount);
    if (!(numericAmount > 0)) {
  return res.status(400).json({ success:false, error: "Amount must be greater than 0" });
    }
    if (!req.file) {
  return res.status(400).json({ success:false, error: "Receipt file is required" });
    }

    // If immediate submission requested, enforce limit BEFORE creating claim
    const wantsImmediateSubmit = submit === 'true' || submit === true
    if (wantsImmediateSubmit) {
      try {
        // Use persisted usedClaimAmount (respects manual resets) instead of re-aggregating historical claims
        const allowedLimit = await Config.getEffectiveClaimLimit(req.user);
        const usedSoFar = req.user.usedClaimAmount || 0;
        if (usedSoFar + numericAmount > allowedLimit) {
          return res.status(400).json({ success:false, error: `Claim amount exceeds allowed remaining (${Math.max(allowedLimit - usedSoFar,0)})` });
        }
      } catch (e) {
        return res.status(500).json({ success:false, error: 'Unable to determine claim limit', detail: e.message });
      }
    }

    // Determine manager snapshot logic
    let managerSnapshot = null;
  if (req.user.role === 'employee') {
      managerSnapshot = req.user.manager || null;
  } else if (req.user.role === 'manager') {
      // Default reviewer to the manager's own supervising manager if present (hierarchical chain)
      managerSnapshot = req.user.manager || null;
      // Allow a manager to optionally pick ANOTHER manager to review their claim via form field 'manager'
      const provided = req.body.manager;
      if (provided) {
        const { User } = require('../models');
        const { Types } = require('mongoose');
        if (!Types.ObjectId.isValid(provided)) {
          return res.status(400).json({ success:false, error: 'Invalid manager id supplied' });
        }
        if (provided.toString() === req.user._id.toString()) {
          return res.status(400).json({ success:false, error: 'Cannot assign yourself as reviewing manager' });
        }
        const mgrUser = await User.findById(provided).select('role isActive');
        if (!mgrUser || !mgrUser.isActive || mgrUser.role !== 'manager') {
          return res.status(400).json({ success:false, error: 'Provided reviewer must be an active manager' });
        }
        managerSnapshot = mgrUser._id; // snapshot chosen manager
      }
    } else if (req.user.role === 'admin') {
      // Admin acts as its own reviewer chain; no manager required
      managerSnapshot = null;
    }

  const claim = await Claim.create({
      user: req.user._id,
      manager: managerSnapshot, // may be null (self-claim) or chosen manager
      userRole: req.user.role,
      title,
      description,
      amount: numericAmount,
    status: submit === 'true' || submit === true ? 'submitted' : 'draft',
      receipt: path.relative(process.cwd(), req.file.path).replace(/\\/g, "/"),
      attachments: [
        {
          originalName: req.file.originalname,
          filename: req.file.filename,
          mimetype: req.file.mimetype,
          size: req.file.size,
          path: path.relative(process.cwd(), req.file.path).replace(/\\/g, "/"),
        },
      ],
    });
  if (claim.status === 'submitted') {
    claim.submittedAt = new Date();
    if (!claim.countedInUsage) { await incrementUsed(req.user._id, claim.amount); claim.countedInUsage = true; await claim.save(); }
  }
  const effectiveClaimLimit = await Config.getEffectiveClaimLimit(req.user);
  const usedAmount = req.user.usedClaimAmount || 0; // already incremented if submitted
  const remaining = Math.max(effectiveClaimLimit - usedAmount, 0);
  return res.status(201).json(success({ claim, effectiveClaimLimit, remainingClaimLimit: remaining }));
  } catch (err) {
    return next(err);
  }
};

// List current user's claims (employee scope)
exports.listMyClaims = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, sortBy, sortDir } = req.query;
    const query = { user: req.user._id };
    if (status) query.status = status.toLowerCase();
    let sortField = 'createdAt';
    if (['submittedAt','amount','approvedAt'].includes(sortBy)) sortField = sortBy;
    const sortDirection = sortDir === 'asc' ? 'asc' : 'desc';
    const response = await paginate(
      Claim.find(query),
      () => Claim.countDocuments(query),
      { page, limit, sortBy: sortField, sortDir: sortDirection, status }
    );
  const effectiveClaimLimit = await Config.getEffectiveClaimLimit(req.user);
  const usedAmount = req.user.usedClaimAmount || 0;
  const remaining = Math.max(effectiveClaimLimit - usedAmount, 0);
  response.data.effectiveClaimLimit = effectiveClaimLimit;
  response.data.remainingClaimLimit = remaining;
    return res.json(response);
  } catch (err) {
    return next(err);
  }
};

// Submit a draft claim (employee -> claim owner)
exports.submitClaim = async (req, res, next) => {
  try {
    const claim = await Claim.findById(req.params.id);
  if (!claim) return res.status(404).json({ success:false, error: "Claim not found" });
    if (claim.user.toString() !== req.user._id.toString()) {
  return res.status(403).json({ success:false, error: "Not your claim" });
    }
    if (claim.status !== "draft") {
  return res.status(400).json({ success:false, error: "Only draft claims can be submitted" });
    }
    // Enforce allowed claim limit when submitting (cumulative usage from persisted counter respecting resets)
    try {
      const allowedLimit = await Config.getEffectiveClaimLimit(req.user);
      const usedSoFar = req.user.usedClaimAmount || 0;
      if (usedSoFar + claim.amount > allowedLimit) {
  return res.status(400).json({ success:false, error: `Claim amount exceeds allowed remaining (${Math.max(allowedLimit - usedSoFar,0)})` });
      }
    } catch (e) {
  return res.status(500).json({ success:false, error: "Unable to determine claim limit", detail: e.message });
    }
  claim.transitionTo("submitted");
  if (!claim.countedInUsage) { await incrementUsed(req.user._id, claim.amount); claim.countedInUsage = true; }
    await claim.save();
    // Recompute remaining after including this claim
    const effectiveClaimLimit = await Config.getEffectiveClaimLimit(req.user);
    const usedAmount = req.user.usedClaimAmount || 0; // incremented earlier
    const remaining = Math.max(effectiveClaimLimit - usedAmount, 0);
  return res.json(success({ claim, effectiveClaimLimit, remainingClaimLimit: remaining }));
  } catch (err) {
    return next(err);
  }
};

// Approve claim (manager or admin)
exports.approveClaim = async (req, res, next) => {
  try {
    const claim = await Claim.findById(req.params.id);
  if (!claim) return res.status(404).json({ success:false, error: "Claim not found" });
    if (claim.status !== "submitted") {
  return res.status(400).json({ success:false, error: "Only submitted claims can be approved" });
    }
    if (req.user.role === 'manager') {
      if (claim.user.toString() === req.user._id.toString()) {
  return res.status(403).json({ success:false, error: 'Managers cannot approve their own claims' });
      }
      if (claim.userRole === 'employee') {
        const ok = await ensureManagerOf(claim, req.user._id);
  if (!ok) return res.status(403).json({ success:false, error: 'Not manager of this employee' });
      }
    }
    // Admin pathway: allow approving any submitted claim including their own when manager is null
    if (req.user.role === 'admin') {
      // no additional checks; admin can self-approve when manager is null
    }
  claim.transitionTo("approved");
    claim.managerReviewer = req.user._id;
    await claim.save();
  return res.json(success({ claim }));
  } catch (err) {
    return next(err);
  }
};

// Reject claim (manager or admin)
exports.rejectClaim = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const claim = await Claim.findById(req.params.id);
  if (!claim) return res.status(404).json({ success:false, error: "Claim not found" });
    if (req.user.role === 'manager') {
      if (claim.user.toString() === req.user._id.toString()) {
  return res.status(403).json({ success:false, error: 'Managers cannot reject their own claims' });
      }
      if (claim.userRole === 'employee') {
        const ok = await ensureManagerOf(claim, req.user._id);
  if (!ok) return res.status(403).json({ success:false, error: 'Not manager of this employee' });
      }
    }
    // Admin can reject any submitted claim including self-claims
    if (claim.status !== "submitted") {
  return res.status(400).json({ success:false, error: "Only submitted claims can be rejected" });
    }
    // If submitted and counted, decrement usage
    if (claim.countedInUsage && claim.status === 'submitted') {
      await decrementUsed(claim.user, claim.amount); claim.countedInUsage = false;
    }
    claim.transitionTo("rejected");
    claim.managerReviewer = req.user._id;
    claim.rejectionReason = reason || "";
    await claim.save();
    return res.json(success({ claim }));
  } catch (err) {
    return next(err);
  }
};

// Reimburse claim (finance or admin)
exports.reimburseClaim = async (req, res, next) => {
  try {
    const claim = await Claim.findById(req.params.id);
  if (!claim) return res.status(404).json({ success:false, error: "Claim not found" });
    if (claim.status !== "approved") {
  return res.status(400).json({ success:false, error: "Only approved claims can be reimbursed" });
    }
  claim.transitionTo("reimbursed");
    claim.financeReviewer = req.user._id;
    await claim.save();
  return res.json(success({ claim }));
  } catch (err) {
    return next(err);
  }
};

// Finance reject after approval (finance or admin)
exports.financeRejectClaim = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const claim = await Claim.findById(req.params.id);
  if (!claim) return res.status(404).json({ success:false, error: 'Claim not found' });
    if (claim.status !== 'approved') {
  return res.status(400).json({ success:false, error: 'Only approved claims can be rejected by finance' });
    }
  if (claim.countedInUsage) { await decrementUsed(claim.user, claim.amount); claim.countedInUsage = false; }
  claim.transitionTo('rejected');
    claim.financeReviewer = req.user._id;
    claim.rejectionReason = reason || '';
    await claim.save();
  return res.json(success({ claim }));
  } catch (err) {
    return next(err);
  }
};

// Manager list submitted claims (filter + pagination)
exports.listSubmitted = async (req, res, next) => {
  try {
    const { page=1, limit=10, status, sortBy, sortDir } = req.query;
    const allowedStatuses = ["submitted", "approved", "rejected"]; 
    const statusFilter = status && allowedStatuses.includes(status) ? status : 'submitted';
    const query = { status: statusFilter };
    if (req.user.role === 'manager') query.manager = req.user._id;
    let sortField = 'submittedAt';
    if (['submittedAt','amount','approvedAt'].includes(sortBy)) sortField = sortBy;
    const direction = sortDir === 'asc' ? 'asc' : 'desc';
    const response = await paginate(
      Claim.find(query).populate('user','name role'),
      () => Claim.countDocuments(query),
      { page, limit, sortBy: sortField, sortDir: direction, status: statusFilter }
    );
    response.data.items = response.data.items.map(doc => {
      const o = doc.toObject({ getters: true });
      if (doc.user) o.employee = { _id: doc.user._id, name: doc.user.name, role: doc.user.role };
      return o;
    });
    return res.json(response);
  } catch (err) {
    return next(err);
  }
};

// Finance list approved claims (optionally reimbursed) with pagination
exports.listForFinance = async (req, res, next) => {
  try {
    const { page=1, limit=10, status, sortBy, sortDir } = req.query;
    const allowedStatuses = ["approved", "reimbursed"]; 
    const statusFilter = status && allowedStatuses.includes(status) ? status : 'approved';
    let sortField = 'approvedAt';
    if (['approvedAt','amount','submittedAt'].includes(sortBy)) sortField = sortBy;
    const direction = sortDir === 'asc' ? 'asc' : 'desc';
    const response = await paginate(
      Claim.find({ status: statusFilter }),
      () => Claim.countDocuments({ status: statusFilter }),
      { page, limit, sortBy: sortField, sortDir: direction, status: statusFilter }
    );
    return res.json(response);
  } catch (err) {
    return next(err);
  }
};

// Update an existing draft claim (owner only, still in draft)
// PATCH /api/claims/:id  (fields: title, description, amount, receipt(optional))
exports.updateDraftClaim = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, amount, description } = req.body;
    const claim = await Claim.findById(id);
  if (!claim) return res.status(404).json({ success:false, error: 'Claim not found' });
    if (claim.user.toString() !== req.user._id.toString()) {
  return res.status(403).json({ success:false, error: 'Not your claim' });
    }
    if (claim.status !== 'draft') {
  return res.status(400).json({ success:false, error: 'Only draft claims can be edited' });
    }
    if (title !== undefined) {
  if (!title) return res.status(400).json({ success:false, error: 'Title cannot be empty' });
      claim.title = title;
    }
    if (description !== undefined) claim.description = description;
    if (amount !== undefined) {
      const numericAmount = Number(amount);
  if (!(numericAmount > 0)) return res.status(400).json({ success:false, error: 'Amount must be greater than 0' });
      claim.amount = numericAmount;
    }
    if (req.file) {
      const rel = path.relative(process.cwd(), req.file.path).replace(/\\/g, '/');
      claim.receipt = rel; // update primary receipt path
      claim.attachments.push({
        originalName: req.file.originalname,
        filename: req.file.filename,
        mimetype: req.file.mimetype,
        size: req.file.size,
        path: rel,
      });
    }
    // Allow manager creator to change assigned reviewing manager while in draft
    if (claim.userRole === 'manager' && req.user.role === 'manager' && req.body.manager !== undefined) {
      const provided = req.body.manager;
      if (provided === null || provided === 'null' || provided === '') {
        // Explicit clear -> self-claim (no reviewer yet)
        claim.manager = null;
      } else {
        const { Types } = require('mongoose');
        if (!Types.ObjectId.isValid(provided)) {
          return res.status(400).json({ success:false, error: 'Invalid manager id supplied' });
        }
        if (provided.toString() === req.user._id.toString()) {
          return res.status(400).json({ success:false, error: 'Cannot assign yourself as reviewing manager' });
        }
        const { User } = require('../models');
        const mgrUser = await User.findById(provided).select('role isActive');
        if (!mgrUser || !mgrUser.isActive || mgrUser.role !== 'manager') {
          return res.status(400).json({ success:false, error: 'Provided reviewer must be an active manager' });
        }
        claim.manager = mgrUser._id;
      }
    }
    await claim.save();
    const effectiveClaimLimit = await Config.getEffectiveClaimLimit(req.user);
  return res.json(success({ claim, effectiveClaimLimit }));
  } catch (err) {
    return next(err);
  }
};

// Delete an existing draft claim (owner only, only while in draft)
// DELETE /api/claims/:id
exports.deleteDraftClaim = async (req, res, next) => {
  try {
    const { id } = req.params;
    const claim = await Claim.findById(id);
  if (!claim) return res.status(404).json({ success:false, error: 'Claim not found' });
    if (claim.user.toString() !== req.user._id.toString()) {
  return res.status(403).json({ success:false, error: 'Not your claim' });
    }
    if (claim.status !== 'draft') {
  return res.status(400).json({ success:false, error: 'Only draft claims can be deleted' });
    }
    // Attempt to delete receipt & attachments from disk (best effort)
    const paths = [];
    if (claim.receipt) paths.push(path.join(process.cwd(), claim.receipt));
    if (Array.isArray(claim.attachments)) {
      for (const a of claim.attachments) {
        if (a.path) paths.push(path.join(process.cwd(), a.path));
      }
    }
    for (const p of new Set(paths)) {
      fs.promises.unlink(p).catch(()=>{}); // ignore errors
    }
    await claim.deleteOne();
  return res.status(200).json(success({ deleted: true }));
  } catch (err) {
    return next(err);
  }
};

// GET manager info for a claim
// GET /api/claims/:id/manager  (claim owner, claim's manager, finance, admin)
exports.getClaimManager = async (req, res, next) => {
  try {
    const { id } = req.params;
    const claim = await Claim.findById(id).select('user manager');
  if (!claim) return res.status(404).json({ success:false, error: 'Claim not found' });
    const requester = req.user;
    const isOwner = claim.user.toString() === requester._id.toString();
    const isClaimManager = claim.manager && claim.manager.toString() === requester._id.toString();
    const elevated = ['admin','finance'].includes(requester.role);
    if (!(isOwner || isClaimManager || elevated)) {
  return res.status(403).json({ success:false, error: 'Not authorized to view manager for this claim' });
    }
    if (!claim.manager) {
  return res.status(404).json({ success:false, error: 'No manager associated with this claim' });
    }
    const { User } = require('../models');
    const manager = await User.findById(claim.manager).select('name email role');
  if (!manager) return res.status(404).json({ success:false, error: 'Manager not found' });
  return res.json(success({ manager }));
  } catch (err) {
    return next(err);
  }
};

// GET single claim with creator (and optional manager) info
// GET /api/claims/:id  (owner, assigned manager snapshot, finance, admin)
exports.getClaim = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { Types } = require('mongoose');
    if (!Types.ObjectId.isValid(id)) {
  return res.status(404).json({ success:false, error: 'Claim not found' });
    }
    const claim = await Claim.findById(id);
  if (!claim) return res.status(404).json({ success:false, error: 'Claim not found' });
    const requester = req.user;
    const isOwner = claim.user.toString() === requester._id.toString();
    const isAssignedManager = claim.manager && claim.manager.toString() === requester._id.toString();
    const elevated = ['admin','finance'].includes(requester.role);
    if (!(isOwner || isAssignedManager || elevated)) {
  return res.status(403).json({ success:false, error: 'Not authorized to view this claim' });
    }
    const { User } = require('../models');
    const creator = await User.findById(claim.user).select('name email role');
    let assignedManager = null;
    if (claim.manager) {
      assignedManager = await User.findById(claim.manager).select('name email role');
    }
    // Provide a minimal, stable shape for frontend
  return res.json(success({ claim, creator, assignedManager }));
  } catch (err) {
    return next(err);
  }
};
