require('dotenv').config();
const express = require('express');
const connectDB = require('./config/db');
const errorHandler = require('./middleware/errorHandler');
const notFound = require('./middleware/notFound');
const path = require('path');
const cron = require('node-cron');
const { User, ClaimUsageResetLog } = require('./models');

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
// Alias routes for claim limits direct access (/api/claim-limits) without breaking existing /api/users/claim-limits
app.use('/api/claim-limits', (req,res,next) => {
	// Re-route to existing userRoutes handlers by prefixing path
	// Support: GET / -> listClaimLimits, PUT /:userId -> updateClaimLimitTotal, POST /recompute/:userId -> recompute
	const orig = req.url;
	if (req.method === 'GET') {
		req.url = '/claim-limits' + (orig === '/' ? '' : orig); // becomes /claim-limits
	} else if (req.method === 'PUT' && /^\/[^\/]+/.test(orig)) {
		// /:userId -> /claim-limits/:userId
		req.url = '/claim-limits' + orig;
	} else if (req.method === 'POST' && orig.startsWith('/recompute/')) {
		req.url = '/claim-limits' + orig; // /recompute/:userId
	}
	return require('./routes/userRoutes')(req,res,next);
});
app.use('/api/config', require('./routes/configRoutes'));
app.use('/uploads', require('./routes/fileRoutes'));
app.use(notFound);
app.use(errorHandler);

// Yearly claim reset (Jan 1 at 00:05) skip in tests
if (process.env.NODE_ENV !== 'test') {
	cron.schedule('5 0 1 1 *', async () => {
		try {
			const res = await User.updateMany({}, { usedClaimAmount: 0, lastClaimResetAt: new Date() });
			await ClaimUsageResetLog.create({ totalUsersAffected: res.modifiedCount || 0, note: 'Annual reset' });
			console.log('✅ Yearly claim usage reset complete');
		} catch (e) {
			console.error('Yearly claim usage reset failed', e);
		}
	});
}

module.exports = app; // exported for server & tests
