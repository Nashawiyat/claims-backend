require('dotenv').config();
const express = require('express');
const connectDB = require('./config/db');
const errorHandler = require('./middleware/errorHandler');
const notFound = require('./middleware/notFound');

const app = express();
app.use(express.json({ limit: '1mb' }));

connectDB();

app.get('/', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/claims', require('./routes/claimRoutes'));
app.use(notFound);
app.use(errorHandler);

module.exports = app; // exported for server & tests
