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

    const claim = await Claim.create({
      user: req.user._id,
  manager: req.user.manager || null,
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
  return res.status(201).json({ claim, effectiveClaimLimit });
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
    return res.json({ page: parsedPage, limit: parsedLimit, total, claims: items });
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
    // Enforce allowed claim limit when submitting
    try {
      const allowedLimit = await Config.getEffectiveClaimLimit(req.user);
      if (claim.amount > allowedLimit) {
        return res.status(400).json({ message: `Claim amount exceeds allowed limit (${allowedLimit})` });
      }
    } catch (e) {
      return res.status(500).json({ message: "Unable to determine claim limit", detail: e.message });
    }
    claim.transitionTo("submitted");
    await claim.save();
    return res.json({ claim });
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
      const ok = await ensureManagerOf(claim, req.user._id);
      if (!ok) return res.status(403).json({ message: 'Not manager of this employee' });
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
    if (claim.status !== "submitted") {
      return res.status(400).json({ message: "Only submitted claims can be rejected" });
    }
    if (req.user.role === 'manager') {
      const ok = await ensureManagerOf(claim, req.user._id);
      if (!ok) return res.status(403).json({ message: 'Not manager of this employee' });
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
      Claim.find(query).sort({ createdAt: -1 }).skip((parsedPage - 1) * parsedLimit).limit(parsedLimit),
      Claim.countDocuments(query),
    ]);
    return res.json({ page: parsedPage, limit: parsedLimit, total, claims: items });
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
