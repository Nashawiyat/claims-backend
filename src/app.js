require('dotenv').config();
const express = require('express');
const connectDB = require('./config/db');
const errorHandler = require('./middleware/errorHandler');
const notFound = require('./middleware/notFound');

const app = express();
app.use(express.json({ limit: '1mb' }));

// Basic CORS setup (limited to specified frontend origin)
const ALLOWED_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
app.use((req, res, next) => {
	res.header('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
	res.header('Vary', 'Origin');
	res.header('Access-Control-Allow-Credentials', 'true');
	res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
	res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
	if (req.method === 'OPTIONS') {
		return res.status(204).end();
	}
	next();
});

connectDB();

app.get('/', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/claims', require('./routes/claimRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/config', require('./routes/configRoutes'));
app.use(notFound);
app.use(errorHandler);

module.exports = app; // exported for server & tests
