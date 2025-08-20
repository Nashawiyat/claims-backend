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

// Create draft claim (employee, manager, admin)
router.post("/", protect, authorize("employee", "manager", "admin"), upload.single("receipt"), claimController.createClaim);

// Update existing draft claim (owner: employee, manager, admin)
router.patch('/:id', protect, authorize('employee','manager','admin'), upload.single('receipt'), claimController.updateDraftClaim);

// Delete draft claim (owner)
router.delete('/:id', protect, authorize('employee','manager','admin'), claimController.deleteDraftClaim);

// List own claims
router.get("/mine", protect, authorize("employee", "manager", "admin"), claimController.listMyClaims);


// Submit draft claim
router.put("/:id/submit", protect, authorize("employee", "manager", "admin"), claimController.submitClaim);

// Approve / reject (manager or admin)
router.put("/:id/approve", protect, authorize("manager","admin"), claimController.approveClaim);
router.put("/:id/reject", protect, authorize("manager","admin"), claimController.rejectClaim);
// Claim manager lookup
router.get('/:id/manager', protect, authorize('employee','manager','finance','admin'), claimController.getClaimManager);
// Manager list submitted/approved/rejected (filtered)
router.get("/manager", protect, authorize("manager"), claimController.listSubmitted);

// Finance reimburse (finance or admin)
router.put("/:id/reimburse", protect, authorize("finance","admin"), claimController.reimburseClaim);
router.put("/:id/reject-finance", protect, authorize("finance","admin"), claimController.financeRejectClaim);
router.get("/finance", protect, authorize("finance","admin"), claimController.listForFinance);

// Get single claim (owner, assigned manager, finance, admin) - placed after other specific routes
router.get('/:id', protect, authorize('employee','manager','finance','admin'), claimController.getClaim);

module.exports = router;
