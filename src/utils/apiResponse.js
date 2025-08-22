"use strict";
function success(data) { return { success: true, data }; }
function failure(error) { return { success: false, error }; }
module.exports = { success, failure };
