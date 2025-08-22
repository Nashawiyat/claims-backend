"use strict";
const { User, Claim } = require('../models');

async function incrementUsed(userId, amount) {
  if (!(amount > 0)) return;
  await User.findByIdAndUpdate(userId, { $inc: { usedClaimAmount: amount } });
}
async function decrementUsed(userId, amount) {
  if (!(amount > 0)) return;
  await User.findByIdAndUpdate(userId, { $inc: { usedClaimAmount: -amount } });
}
async function recomputeUsedForUser(userId) {
  const agg = await Claim.aggregate([
    { $match: { user: require('mongoose').Types.ObjectId(userId), status: { $in: ['submitted','approved','reimbursed'] } } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);
  const total = agg.length ? agg[0].total : 0;
  await User.findByIdAndUpdate(userId, { usedClaimAmount: total });
  return total;
}
// Public alias expected by new requirements
async function recomputeUsed(userId) { return recomputeUsedForUser(userId); }
module.exports = { incrementUsed, decrementUsed, recomputeUsedForUser, recomputeUsed };
