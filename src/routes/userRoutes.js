"use strict";
const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middleware/authMiddleware");
const userController = require("../controllers/userController");

// Public list of managers for registration UI (could add rate limiting if exposed publicly)
router.get('/managers', userController.listManagers);

// Adjust a user's claim limit (admin & finance)
router.patch("/:id/limit", protect, authorize("admin", "finance"), userController.updateClaimLimit);
router.patch("/:id/manager", protect, authorize("admin"), userController.updateManager);

module.exports = router;
