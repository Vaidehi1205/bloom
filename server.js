const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { initScheduler } = require('./scheduler');
const { getDb } = require('./mongodb');

// Load environment variables
dotenv.config();

const app = express();
const DEFAULT_PORT = Number(process.env.PORT || 5000);

// Middleware
app.use(cors({
  origin: '*', // Allow connections from Vite frontend locally
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Initialize background jobs and MongoDB after startup
initScheduler();
require('./mongodb')
  .initMongo()
  .then((res) => {
    if (res) console.log('[Mongo] Mongo is available; requests will use MongoDB.');
    else console.warn('[Mongo] Mongo is NOT available; requests depending on MongoDB may fail.');
  })
  .catch((e) => {
    console.error('[Mongo] MongoDB init threw:', e);
  });


// Mount Routes

app.use('/api/auth', require('./routes/auth'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/cycle-logs', require('./routes/cycle-logs'));
app.use('/api/daily-logs', require('./routes/daily-logs'));
app.use('/api/plans', require('./routes/plans'));
app.use('/api/predictions', require('./routes/predictions'));
app.use('/api/content-feed', require('./routes/content-feed'));
app.use('/api/insights', require('./routes/insights'));
app.use('/api/community', require('./routes/community'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/settings', require('./routes/settings'));

// Notifications Route (deliver health notifications/triage warnings to user)
const authMiddleware = require('./middleware/auth');
app.get('/api/notifications', authMiddleware, async (req, res) => {
  try {
    const database = await getDb();
    const col = database.collection('notifications');

    const notifs = await col
      .find({ user_id: req.user.id })
      .sort({ scheduled_for: -1 })
      .limit(15)
      .toArray();

    res.json(
      notifs.map((d) => ({
        id: d._id?.toString?.() ?? d._id,
        ...d
      }))
    );
  } catch (error) {
    console.error('Fetch notifications error:', error);
    res.status(500).json({ error: 'Failed to fetch user notifications.' });
  }
});

// Dismiss notifications
app.delete('/api/notifications/:id', authMiddleware, async (req, res) => {
  try {
    const database = await getDb();
    const col = database.collection('notifications');

    await col.deleteOne({
      _id: req.params.id,
      user_id: req.user.id
    });
    res.json({ message: 'Notification dismissed.' });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ error: 'Failed to dismiss notification.' });
  }
});

// Audit Actions Route (for profile settings or dev logs display)
app.get('/api/agent-actions', authMiddleware, async (req, res) => {
  try {
    const database = await getDb();
    const col = database.collection('agent_actions');

    const actions = await col
      .find({ user_id: req.user.id })
      .sort({ created_at: -1 })
      .limit(30)
      .toArray();

    res.json(
      actions.map((d) => ({
        id: d._id?.toString?.() ?? d._id,
        ...d
      }))
    );
  } catch (error) {
    console.error('Fetch agent actions error:', error);
    res.status(500).json({ error: 'Failed to fetch audit actions.' });
  }
});

// Root check endpoint
app.get('/', (req, res) => {
  res.json({ message: 'Bloom API Server is online.' });
});

// Mongo health/debug endpoint
app.get('/api/db/health', async (req, res) => {
  // Do not expose secrets; only show connection status + env presence
  const envPresent = {
    MONGODB_URI: Boolean(process.env.MONGODB_URI),
    MONGO_URI: Boolean(process.env.MONGO_URI),
    MONGODB_DB_NAME: Boolean(process.env.MONGODB_DB_NAME),
    MONGODB_TLS: process.env.MONGODB_TLS || null,
    MONGODB_TLS_ALLOW_UNAUTHORIZED: process.env.MONGODB_TLS_ALLOW_UNAUTHORIZED || null,
    MONGODB_CONNECT_RETRIES: process.env.MONGODB_CONNECT_RETRIES || null,
  };

  try {
    // Ensure we attempt a connection once if not already connected
    const mongo = require('./mongodb');
    const dbInstance = await mongo.initMongo();

    let connected = false;
    let dbName = null;
    try {
      // If initMongo returned null, getDb() will throw
      if (dbInstance) connected = true;

      // Best-effort dbName: read from env with same default as mongodb.js
      dbName = process.env.MONGODB_DB_NAME || 'bloom';
    } catch {
      connected = false;
    }

    return res.json({
      connected,
      dbName,
      envPresent,
      note: connected
        ? 'Mongo is connected. API routes using MongoDB should work.'
        : 'Mongo is not connected. Check server logs for the exact Mongo error.',
    });
  } catch (e) {
    return res.status(500).json({
      connected: false,
      envPresent,
      error: e?.message || String(e),
    });
  }
});


function startServer(port = DEFAULT_PORT, attempt = 1) {
  const server = app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      const nextPort = port + 1;
      const maxAttempts = 10;
      if (attempt < maxAttempts) {
        console.warn(`Port ${port} is busy. Trying ${nextPort} instead...`);
        server.close(() => startServer(nextPort, attempt + 1));
      } else {
        console.error(`Unable to start the server after ${maxAttempts} attempts.`);
        process.exit(1);
      }
      return;
    }

    console.error('Failed to start server:', error);
    process.exit(1);
  });
}

startServer();