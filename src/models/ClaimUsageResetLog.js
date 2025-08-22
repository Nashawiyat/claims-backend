"use strict";
const mongoose = require('mongoose');

const ClaimUsageResetLogSchema = new mongoose.Schema({
  runAt: { type: Date, default: Date.now, index: true },
  totalUsersAffected: { type: Number, default: 0 },
  note: { type: String }
},{ timestamps: true });

module.exports = mongoose.model('ClaimUsageResetLog', ClaimUsageResetLogSchema);
