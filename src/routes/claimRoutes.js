"use strict";
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const { protect, authorize } = require("../middleware/authMiddleware");
const claimController = require("../controllers/claimController");

// Multer storage
const storage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, path.join(process.cwd(), "uploads"));
  },
  filename: function (_req, file, cb) {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, unique + ext);
  },
});

function fileFilter(_req, file, cb) {
  // Basic mime filter (accept images or pdf)
  if (/^image\//.test(file.mimetype) || file.mimetype === "application/pdf") {
    cb(null, true);
  } else {
    cb(new Error("Only image or PDF receipts allowed"));
  }
}

const upload = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } });

// Employee create draft claim
router.post("/", protect, authorize("employee"), upload.single("receipt"), claimController.createClaim);

// Employee list own claims
router.get("/mine", protect, authorize("employee"), claimController.listMyClaims);

// Employee submit draft claim
router.put("/:id/submit", protect, authorize("employee"), claimController.submitClaim);

// Manager approve / reject
router.put("/:id/approve", protect, authorize("manager"), claimController.approveClaim);
router.put("/:id/reject", protect, authorize("manager"), claimController.rejectClaim);
// Manager list submitted/approved/rejected (filtered)
router.get("/manager", protect, authorize("manager"), claimController.listSubmitted);

// Finance reimburse
router.put("/:id/reimburse", protect, authorize("finance"), claimController.reimburseClaim);
// Finance list approved/reimbursed
router.get("/finance", protect, authorize("finance"), claimController.listForFinance);

module.exports = router;
