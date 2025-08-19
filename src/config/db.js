const mongoose = require("mongoose");

const connectDB = async () => {
  // In test runs, individual test files may set MONGO_URI dynamically (mongodb-memory-server) after app import.
  // If no URI is present yet, skip connecting; tests will establish their own connection.
  const uri = process.env.MONGO_URI;
  if (!uri) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('⚠️  MONGO_URI not set; skipping initial DB connection');
    }
    return;
  }
  try {
    // If already connected (e.g., memory server), don't reconnect
    if (mongoose.connection.readyState === 1) return;
    await mongoose.connect(uri);
    console.log("✅ MongoDB connected...");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err.message);
    if (process.env.NODE_ENV !== 'test') {
      process.exit(1);
    } else {
      throw err;
    }
  }
};

module.exports = connectDB;
