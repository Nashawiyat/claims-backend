"use strict";
/**
 * Claim Controller
 * Handles creation and workflow transitions for claims.
 */

const path = require("path");
const fs = require("fs");
const { Claim, Config } = require("../models");

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
    const claims = await Claim.find({ user: req.user._id }).sort({ createdAt: -1 });
    return res.json({ claims });
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
    claim.transitionTo("submitted");
    await claim.save();
    return res.json({ claim });
  } catch (err) {
    return next(err);
  }
};

// Approve claim (manager)
exports.approveClaim = async (req, res, next) => {
  try {
    const claim = await Claim.findById(req.params.id);
    if (!claim) return res.status(404).json({ message: "Claim not found" });
    if (claim.status !== "submitted") {
      return res.status(400).json({ message: "Only submitted claims can be approved" });
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

// Manager list submitted claims (filter + pagination)
exports.listSubmitted = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
    const query = { };
    // Manager sees only submitted (optional status filter for approved/rejected?)
    const allowedStatuses = ["submitted", "approved", "rejected"]; // workflow subset relevant to manager
    if (status) {
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ message: "Invalid status filter" });
      }
      query.status = status;
    } else {
      query.status = "submitted";
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
