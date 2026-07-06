const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { initScheduler } = require('./scheduler');
const db = require('./db');

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
require('./mongodb').initMongo().catch((e) => {
  console.error('MongoDB init failed:', e);
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
    const notifRes = await db.query(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY scheduled_for DESC LIMIT 15',
      [req.user.id]
    );
    res.json(notifRes.rows);
  } catch (error) {
    console.error('Fetch notifications error:', error);
    res.status(500).json({ error: 'Failed to fetch user notifications.' });
  }
});

// Dismiss notifications
app.delete('/api/notifications/:id', authMiddleware, async (req, res) => {
  try {
    await db.query(
      'DELETE FROM notifications WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ message: 'Notification dismissed.' });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ error: 'Failed to dismiss notification.' });
  }
});

// Audit Actions Route (for profile settings or dev logs display)
app.get('/api/agent-actions', authMiddleware, async (req, res) => {
  try {
    const actionsRes = await db.query(
      'SELECT * FROM agent_actions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30',
      [req.user.id]
    );
    res.json(actionsRes.rows);
  } catch (error) {
    console.error('Fetch agent actions error:', error);
    res.status(500).json({ error: 'Failed to fetch audit actions.' });
  }
});

// Root check endpoint
app.get('/', (req, res) => {
  res.json({ message: 'Bloom API Server is online.' });
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
