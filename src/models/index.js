// Export all models from a single entry point for convenience
const Config = require('./Config')
module.exports = {
  User: require('./User'),
  Claim: require('./Claim'),
  Config: Config,
  ConfigHistory: Config.ConfigHistory,
  ClaimUsageResetLog: require('./ClaimUsageResetLog')
};
