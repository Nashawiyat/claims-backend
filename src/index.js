require("dotenv").config();
const express = require("express");
const connectDB = require("./config/db");
const errorHandler = require("./middleware/errorHandler");
const notFound = require("./middleware/notFound");

const app = express();

// Core middleware
app.use(express.json({ limit: "1mb" }));

// Connect Database
connectDB();

// Health check
app.get("/", (_req, res) => res.json({ status: "ok" }));

// Routes
app.use("/api/auth", require("./routes/authRoutes"));

// 404 handler
app.use(notFound);
// Error handler
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
