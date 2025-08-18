"use strict";
/**
 * Claim model
 * Represents an expense/claim submitted by an employee.
 */

const mongoose = require("mongoose");

// Possible lifecycle statuses
const CLAIM_STATUSES = Object.freeze([
  "draft", // created but not yet submitted
  "submitted", // waiting for manager review
  "approved", // manager approved; waiting for finance reimbursement
  "rejected", // rejected by manager or finance
  "reimbursed", // reimbursed by finance
]);

// Attachment subdocument schema
const AttachmentSchema = new mongoose.Schema(
  {
    originalName: { type: String, required: true },
    filename: { type: String, required: true }, // internal stored filename
    mimetype: { type: String, required: true },
    size: { type: Number, required: true, min: 0 },
    path: { type: String }, // local or cloud storage path
    url: { type: String }, // public URL if stored remotely
  },
  { _id: false, timestamps: false }
);

const ClaimSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    description: { type: String, trim: true, maxlength: 2000 },
    amount: { type: Number, required: true, min: 0 },
    // Required single receipt path (while attachments array supports future multiple files)
    receipt: { type: String, required: true },
    status: {
      type: String,
      enum: CLAIM_STATUSES,
      default: "draft",
      index: true,
    },
    attachments: { type: [AttachmentSchema], default: [] },
    managerReviewer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    financeReviewer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedAt: { type: Date },
    rejectedAt: { type: Date },
    reimbursedAt: { type: Date },
    rejectionReason: { type: String, maxlength: 1000 },
  },
  { timestamps: true }
);

// Useful indexes
ClaimSchema.index({ user: 1, status: 1, createdAt: -1 });
ClaimSchema.index({ status: 1, createdAt: -1 });

// Basic status transition validation (soft enforcement; can be extended)
const VALID_TRANSITIONS = {
  draft: ["submitted"],
  submitted: ["approved", "rejected"],
  approved: ["reimbursed", "rejected"],
  rejected: [],
  reimbursed: [],
};

ClaimSchema.methods.canTransitionTo = function (nextStatus) {
  return VALID_TRANSITIONS[this.status].includes(nextStatus);
};

ClaimSchema.methods.transitionTo = function (nextStatus) {
  if (!this.canTransitionTo(nextStatus)) {
    throw new Error(`Invalid status transition ${this.status} -> ${nextStatus}`);
  }
  this.status = nextStatus;
  const now = new Date();
  if (nextStatus === "approved") this.approvedAt = now;
  if (nextStatus === "rejected") this.rejectedAt = now;
  if (nextStatus === "reimbursed") this.reimbursedAt = now;
  return this;
};

// Static helpers
ClaimSchema.statics.getStatuses = () => CLAIM_STATUSES.slice();

module.exports = mongoose.model("Claim", ClaimSchema);
module.exports.CLAIM_STATUSES = CLAIM_STATUSES;
