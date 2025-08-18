"use strict";
const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middleware/authMiddleware");
const userController = require("../controllers/userController");

// Adjust a user's claim limit (admin & finance)
router.patch("/:id/limit", protect, authorize("admin", "finance"), userController.updateClaimLimit);

module.exports = router;
