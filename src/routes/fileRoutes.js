"use strict";
const express = require('express');
const router = express.Router();
const fileController = require('../controllers/fileController');

// Publicly served receipts (consider adding auth or signed URLs later)
router.get('/:file', fileController.getUpload);

module.exports = router;
