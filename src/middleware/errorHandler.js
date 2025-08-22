"use strict";
/**
 * Centralized error handler middleware.
 */
// eslint-disable-next-line no-unused-vars
module.exports = (err, _req, res, _next) => {
  if (res.headersSent) return;
  let status = err.status || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message || 'Internal Server Error';
  let details;

  // Mongoose validation
  if (err.name === 'ValidationError') {
    status = 400; code = 'VALIDATION_ERROR';
    details = Object.values(err.errors).map(e => ({ field: e.path, message: e.message }));
    message = 'Validation failed';
  }
  // Duplicate key
  else if (err.code === 11000) {
    status = 409; code = 'DUPLICATE_KEY';
    details = Object.keys(err.keyValue).map(k => ({ field: k, value: err.keyValue[k] }));
    message = 'Duplicate key error';
  }
  // Fallback sanitize
  if (status >= 500) {
    console.error('❌ Error:', err); // full stack only for server logs
    message = 'Internal Server Error';
  }
  return res.status(status).json({ success: false, error: message, code, ...(details?{details}: {}) });
};
