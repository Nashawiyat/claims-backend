"use strict";
const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { protect } = require("../middleware/authMiddleware");

// Registration
router.post("/register", authController.register);

// Login
router.post("/login", authController.login);

// Current user profile (protected)
router.get("/me", protect, (req, res) => {
	res.json({ user: req.user.toJSON() });
});

module.exports = router;
