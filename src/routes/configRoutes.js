"use strict";
const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middleware/authMiddleware");
const configController = require("../controllers/configController");

// Legacy patch (admin only) - keep
router.patch("/", protect, authorize("admin"), configController.updateConfig);

// Set default claim limit (finance, admin)
router.put('/default-limit', protect, authorize('finance','admin'), configController.setDefaultLimit);

// Set user claim limit override (finance, admin)
router.put('/user-limit', protect, authorize('finance','admin'), configController.setUserLimit);

module.exports = router;
