"use strict";
/** File Controller: serving uploaded receipts */
const path = require('path');
const fs = require('fs');

// GET /uploads/:file
exports.getUpload = async (req, res) => {
  const fileName = req.params.file;
  if (!/^[A-Za-z0-9_.-]+$/.test(fileName)) {
    return res.status(400).json({ message: 'Invalid file name' });
  }
  const base = path.join(process.cwd(), 'uploads');
  const filePath = path.join(base, fileName);
  if (!filePath.startsWith(base)) {
    return res.status(400).json({ message: 'Invalid path' });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'File not found' });
  }
  return res.sendFile(filePath);
};
