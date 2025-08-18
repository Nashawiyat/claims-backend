"use strict";
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status || 500;
    this.code = code || 'INTERNAL_ERROR';
    if (details) this.details = details;
  }
  static badRequest(message, code='BAD_REQUEST', details) { return new AppError(400, code, message, details); }
  static notFound(message='Not Found', code='NOT_FOUND') { return new AppError(404, code, message); }
  static forbidden(message='Forbidden', code='FORBIDDEN') { return new AppError(403, code, message); }
  static unauthorized(message='Unauthorized', code='AUTH_REQUIRED') { return new AppError(401, code, message); }
}
module.exports = AppError;
