"use strict";
const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middleware/authMiddleware");
const userController = require("../controllers/userController");

// Public list of managers for registration UI (could add rate limiting if exposed publicly)
router.get('/managers', userController.listManagers);

// Lookup by email (admin & finance) must come before any /:id param routes
router.get('/lookup', protect, authorize('admin','finance'), userController.lookupUserByEmail);

// Admin user management CRUD
router.get('/', protect, authorize('admin'), userController.listUsers);
router.post('/', protect, authorize('admin'), userController.createUser);
router.put('/:id', protect, authorize('admin'), userController.updateUser);
router.delete('/:id', protect, authorize('admin'), userController.deleteUser);

// Claim limits management
router.get('/claim-limits', protect, authorize('finance','admin'), userController.listClaimLimits);
router.put('/claim-limits/:userId', protect, authorize('finance','admin'), userController.updateClaimLimitTotal);
router.post('/claim-limits/recompute/:userId', protect, authorize('finance','admin'), userController.recomputeClaimUsage);
// Bulk operations
router.post('/claim-limits/apply-defaults', protect, authorize('finance','admin'), userController.applyRoleDefaultLimits);
router.post('/claim-limits/reset-used-all', protect, authorize('finance','admin'), userController.resetAllUsed);

// Adjust a user's claim limit (admin & finance)
router.patch("/:id/limit", protect, authorize("admin", "finance"), userController.updateClaimLimit);
router.patch("/:id/manager", protect, authorize("admin"), userController.updateManager);
router.get('/:id/claim-limit', protect, authorize('employee','manager','finance','admin'), userController.getClaimLimit);
router.get('/:id', protect, authorize('employee','manager','finance','admin'), userController.getUser);
router.get('/:id/manager', protect, authorize('employee','manager','finance','admin'), userController.getUserManager);

module.exports = router;
