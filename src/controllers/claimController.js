"use strict";
/**
 * Claim Controller
 * Handles creation and workflow transitions for claims.
 */

const path = require("path");
const fs = require("fs");
const { Claim, Config } = require("../models");

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
  const { title, amount, description } = req.body;
    if (!title || !amount) {
      return res.status(400).json({ message: "Title and amount are required" });
    }
    const numericAmount = Number(amount);
    if (!(numericAmount > 0)) {
      return res.status(400).json({ message: "Amount must be greater than 0" });
    }
    if (!req.file) {
      return res.status(400).json({ message: "Receipt file is required" });
    }

    // Determine manager snapshot logic
    let managerSnapshot = null;
    if (req.user.role === 'employee') {
      managerSnapshot = req.user.manager || null;
    } else if (req.user.role === 'manager') {
      // Allow a manager to optionally pick ANOTHER manager to review their claim via form field 'manager'
      const provided = req.body.manager;
      if (provided) {
        const { User } = require('../models');
        const isValidId = require('mongoose').Types.ObjectId.isValid(provided);
        if (!isValidId) {
          return res.status(400).json({ message: 'Invalid manager id supplied' });
        }
        if (provided.toString() === req.user._id.toString()) {
          return res.status(400).json({ message: 'Cannot assign yourself as reviewing manager' });
        }
        const mgrUser = await User.findById(provided).select('role isActive');
        if (!mgrUser || !mgrUser.isActive || mgrUser.role !== 'manager') {
          return res.status(400).json({ message: 'Provided reviewer must be an active manager' });
        }
        managerSnapshot = mgrUser._id; // snapshot chosen manager
      }
    }

    const claim = await Claim.create({
      user: req.user._id,
      manager: managerSnapshot, // may be null (self-claim) or chosen manager
      userRole: req.user.role,
      title,
      description,
      amount: numericAmount,
      status: "draft",
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
  const effectiveClaimLimit = await Config.getEffectiveClaimLimit(req.user);
  // Remaining = effective - sum of submitted/approved/reimbursed amounts (exclude drafts & rejected)
  const used = await Claim.aggregate([
    { $match: { user: req.user._id, status: { $in: ['submitted','approved','reimbursed'] } } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);
  const usedAmount = used.length ? used[0].total : 0;
  const remaining = Math.max(effectiveClaimLimit - usedAmount, 0);
  return res.status(201).json({ claim, effectiveClaimLimit, remainingClaimLimit: remaining });
  } catch (err) {
    return next(err);
  }
};

// List current user's claims (employee scope)
exports.listMyClaims = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const query = { user: req.user._id };
    const [items, total] = await Promise.all([
      Claim.find(query).sort({ createdAt: -1 }).skip((parsedPage - 1) * parsedLimit).limit(parsedLimit),
      Claim.countDocuments(query)
    ]);
    // Provide current remaining limit snapshot for UI convenience
    const effectiveClaimLimit = await Config.getEffectiveClaimLimit(req.user);
    const used = await Claim.aggregate([
      { $match: { user: req.user._id, status: { $in: ['submitted','approved','reimbursed'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const usedAmount = used.length ? used[0].total : 0;
    const remaining = Math.max(effectiveClaimLimit - usedAmount, 0);
    return res.json({ page: parsedPage, limit: parsedLimit, total, claims: items, effectiveClaimLimit, remainingClaimLimit: remaining });
  } catch (err) {
    return next(err);
  }
};

// Submit a draft claim (employee -> claim owner)
exports.submitClaim = async (req, res, next) => {
  try {
    const claim = await Claim.findById(req.params.id);
    if (!claim) return res.status(404).json({ message: "Claim not found" });
    if (claim.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not your claim" });
    }
    if (claim.status !== "draft") {
      return res.status(400).json({ message: "Only draft claims can be submitted" });
    }
    // Enforce allowed claim limit when submitting (cumulative usage)
    try {
      const allowedLimit = await Config.getEffectiveClaimLimit(req.user);
      const usedAgg = await Claim.aggregate([
        { $match: { user: req.user._id, status: { $in: ['submitted','approved','reimbursed'] } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]);
      const usedSoFar = usedAgg.length ? usedAgg[0].total : 0;
      if (usedSoFar + claim.amount > allowedLimit) {
        return res.status(400).json({ message: `Claim amount exceeds allowed remaining (${allowedLimit - usedSoFar})` });
      }
    } catch (e) {
      return res.status(500).json({ message: "Unable to determine claim limit", detail: e.message });
    }
    claim.transitionTo("submitted");
    await claim.save();
    // Recompute remaining after including this claim
    const effectiveClaimLimit = await Config.getEffectiveClaimLimit(req.user);
    const used = await Claim.aggregate([
      { $match: { user: req.user._id, status: { $in: ['submitted','approved','reimbursed'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const usedAmount = used.length ? used[0].total : 0;
    const remaining = Math.max(effectiveClaimLimit - usedAmount, 0);
    return res.json({ claim, effectiveClaimLimit, remainingClaimLimit: remaining });
  } catch (err) {
    return next(err);
  }
};

// Approve claim (manager or admin)
exports.approveClaim = async (req, res, next) => {
  try {
    const claim = await Claim.findById(req.params.id);
    if (!claim) return res.status(404).json({ message: "Claim not found" });
    if (claim.status !== "submitted") {
      return res.status(400).json({ message: "Only submitted claims can be approved" });
    }
    if (req.user.role === 'manager') {
      // prevent self-approval
      if (claim.user.toString() === req.user._id.toString()) {
        return res.status(403).json({ message: 'Managers cannot approve their own claims' });
      }
      // If claim belongs to an employee ensure direct report
      if (claim.userRole === 'employee') {
        const ok = await ensureManagerOf(claim, req.user._id);
        if (!ok) return res.status(403).json({ message: 'Not manager of this employee' });
      }
    }
    claim.transitionTo("approved");
    claim.managerReviewer = req.user._id;
    await claim.save();
    return res.json({ claim });
  } catch (err) {
    return next(err);
  }
};

// Reject claim (manager)
exports.rejectClaim = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const claim = await Claim.findById(req.params.id);
    if (!claim) return res.status(404).json({ message: "Claim not found" });
    if (req.user.role === 'manager') {
      if (claim.user.toString() === req.user._id.toString()) {
        return res.status(403).json({ message: 'Managers cannot reject their own claims' });
      }
      if (claim.userRole === 'employee') {
        const ok = await ensureManagerOf(claim, req.user._id);
        if (!ok) return res.status(403).json({ message: 'Not manager of this employee' });
      }
    }
    if (claim.status !== "submitted") {
      return res.status(400).json({ message: "Only submitted claims can be rejected" });
    }
    claim.transitionTo("rejected");
    claim.managerReviewer = req.user._id;
    claim.rejectionReason = reason || "";
    await claim.save();
    return res.json({ claim });
  } catch (err) {
    return next(err);
  }
};

// Reimburse claim (finance)
exports.reimburseClaim = async (req, res, next) => {
  try {
    const claim = await Claim.findById(req.params.id);
    if (!claim) return res.status(404).json({ message: "Claim not found" });
    if (claim.status !== "approved") {
      return res.status(400).json({ message: "Only approved claims can be reimbursed" });
    }
    claim.transitionTo("reimbursed");
    claim.financeReviewer = req.user._id;
    await claim.save();
    return res.json({ claim });
  } catch (err) {
    return next(err);
  }
};

// Finance reject after approval (finance or admin)
exports.financeRejectClaim = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const claim = await Claim.findById(req.params.id);
    if (!claim) return res.status(404).json({ message: 'Claim not found' });
    if (claim.status !== 'approved') {
      return res.status(400).json({ message: 'Only approved claims can be rejected by finance' });
    }
    claim.transitionTo('rejected');
    claim.financeReviewer = req.user._id;
    claim.rejectionReason = reason || '';
    await claim.save();
    return res.json({ claim });
  } catch (err) {
    return next(err);
  }
};

// Manager list submitted claims (filter + pagination)
exports.listSubmitted = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
    const allowedStatuses = ["submitted", "approved", "rejected"]; 
    const query = { status: status && allowedStatuses.includes(status) ? status : 'submitted' };
    if (req.user.role === 'manager') {
      query.manager = req.user._id; // use snapshot index
    }
    const [items, total] = await Promise.all([
      Claim.find(query)
        .sort({ createdAt: -1 })
        .skip((parsedPage - 1) * parsedLimit)
        .limit(parsedLimit)
        // Provide creator basic identity (name, role) so reviewing manager can display submitter
        .populate('user', 'name role'),
      Claim.countDocuments(query),
    ]);
    // Normalize: expose a consistent "employee" field (even if creator is a manager) for UI labels
    const claims = items.map(doc => {
      const o = doc.toObject({ getters: true });
      if (doc.user) {
        o.employee = { _id: doc.user._id, name: doc.user.name, role: doc.user.role };
      }
      return o;
    });
    return res.json({ page: parsedPage, limit: parsedLimit, total, claims });
  } catch (err) {
    return next(err);
  }
};

// Finance list approved claims (optionally reimbursed) with pagination
exports.listForFinance = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
    const allowedStatuses = ["approved", "reimbursed"]; // finance cares about these
    let queryStatus = "approved";
    if (status) {
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ message: "Invalid status filter" });
      }
      queryStatus = status;
    }
    const query = { status: queryStatus };
    const [items, total] = await Promise.all([
      Claim.find(query).sort({ createdAt: -1 }).skip((parsedPage - 1) * parsedLimit).limit(parsedLimit),
      Claim.countDocuments(query),
    ]);
    return res.json({ page: parsedPage, limit: parsedLimit, total, claims: items });
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
    if (!claim) return res.status(404).json({ message: 'Claim not found' });
    if (claim.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not your claim' });
    }
    if (claim.status !== 'draft') {
      return res.status(400).json({ message: 'Only draft claims can be edited' });
    }
    if (title !== undefined) {
      if (!title) return res.status(400).json({ message: 'Title cannot be empty' });
      claim.title = title;
    }
    if (description !== undefined) claim.description = description;
    if (amount !== undefined) {
      const numericAmount = Number(amount);
      if (!(numericAmount > 0)) return res.status(400).json({ message: 'Amount must be greater than 0' });
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
          return res.status(400).json({ message: 'Invalid manager id supplied' });
        }
        if (provided.toString() === req.user._id.toString()) {
          return res.status(400).json({ message: 'Cannot assign yourself as reviewing manager' });
        }
        const { User } = require('../models');
        const mgrUser = await User.findById(provided).select('role isActive');
        if (!mgrUser || !mgrUser.isActive || mgrUser.role !== 'manager') {
          return res.status(400).json({ message: 'Provided reviewer must be an active manager' });
        }
        claim.manager = mgrUser._id;
      }
    }
    await claim.save();
    const effectiveClaimLimit = await Config.getEffectiveClaimLimit(req.user);
    return res.json({ claim, effectiveClaimLimit });
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
    if (!claim) return res.status(404).json({ message: 'Claim not found' });
    if (claim.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not your claim' });
    }
    if (claim.status !== 'draft') {
      return res.status(400).json({ message: 'Only draft claims can be deleted' });
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
    return res.status(204).end();
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
    if (!claim) return res.status(404).json({ message: 'Claim not found' });
    const requester = req.user;
    const isOwner = claim.user.toString() === requester._id.toString();
    const isClaimManager = claim.manager && claim.manager.toString() === requester._id.toString();
    const elevated = ['admin','finance'].includes(requester.role);
    if (!(isOwner || isClaimManager || elevated)) {
      return res.status(403).json({ message: 'Not authorized to view manager for this claim' });
    }
    if (!claim.manager) {
      return res.status(404).json({ message: 'No manager associated with this claim' });
    }
    const { User } = require('../models');
    const manager = await User.findById(claim.manager).select('name email role');
    if (!manager) return res.status(404).json({ message: 'Manager not found' });
    return res.json({ manager });
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
      return res.status(404).json({ message: 'Claim not found' });
    }
    const claim = await Claim.findById(id);
    if (!claim) return res.status(404).json({ message: 'Claim not found' });
    const requester = req.user;
    const isOwner = claim.user.toString() === requester._id.toString();
    const isAssignedManager = claim.manager && claim.manager.toString() === requester._id.toString();
    const elevated = ['admin','finance'].includes(requester.role);
    if (!(isOwner || isAssignedManager || elevated)) {
      return res.status(403).json({ message: 'Not authorized to view this claim' });
    }
    const { User } = require('../models');
    const creator = await User.findById(claim.user).select('name email role');
    let assignedManager = null;
    if (claim.manager) {
      assignedManager = await User.findById(claim.manager).select('name email role');
    }
    // Provide a minimal, stable shape for frontend
    return res.json({
      claim,
      creator,
      assignedManager
    });
  } catch (err) {
    return next(err);
  }
};
