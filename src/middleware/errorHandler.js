"use strict";
/**
 * Centralized error handler middleware.
 */
// eslint-disable-next-line no-unused-vars
module.exports = (err, _req, res, _next) => {
  console.error("❌ Error:", err); // Log full error server-side
  if (res.headersSent) return; // Avoid sending twice

  let status = 500;
  let message = "Internal Server Error";

  // Mongoose validation errors
  if (err.name === "ValidationError") {
    status = 400;
    message = err.message;
  }

  // Duplicate key error
  if (err.code && err.code === 11000) {
    status = 409;
    message = `Duplicate value for field(s): ${Object.keys(err.keyValue).join(", ")}`;
  }

  return res.status(status).json({ message });
};
