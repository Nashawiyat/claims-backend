"use strict";
const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middleware/authMiddleware");
const configController = require("../controllers/configController");

// Update global configuration (admin only)
router.patch("/", protect, authorize("admin"), configController.updateConfig);

module.exports = router;
