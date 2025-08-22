"use strict";
const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middleware/authMiddleware");
const configController = require("../controllers/configController");

// New unified endpoints
router.get('/', protect, authorize('finance','admin'), configController.getConfig);
router.put('/', protect, authorize('finance','admin'), configController.putConfig);

// Legacy patch (admin only) - retained for backward compatibility (maps through controller logic)
// (kept but now effectively superseded by PUT /)
// router.patch("/", protect, authorize("admin"), configController.updateConfig); // deprecated

// Set default claim limit (finance, admin)
router.put('/default-limit', protect, authorize('finance','admin'), configController.setDefaultLimit);

// Set user claim limit override (finance, admin)
router.put('/user-limit', protect, authorize('finance','admin'), configController.setUserLimit);

module.exports = router;
