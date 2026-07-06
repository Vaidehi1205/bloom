const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middleware/auth');

// GET PHASE-AWARE ARTICLE
router.get('/', authMiddleware, async (req, res) => {
  const { phase, locale } = req.query;

  if (!phase) {
    return res.status(400).json({ error: 'Phase query parameter is required.' });
  }

  const queryLocale = locale || req.user.locale || 'en';

  try {
    const articleRes = await db.query(
      'SELECT * FROM content_feed WHERE phase_tag = $1 AND locale = $2 LIMIT 1',
      [phase.toLowerCase(), queryLocale]
    );

    if (articleRes.rows.length === 0) {
      // Fallback: try finding English article for the phase
      const fallbackRes = await db.query(
        'SELECT * FROM content_feed WHERE phase_tag = $1 AND locale = $2 LIMIT 1',
        [phase.toLowerCase(), 'en']
      );
      if (fallbackRes.rows.length === 0) {
        return res.status(404).json({ error: 'No article found for this cycle phase.' });
      }
      return res.json(fallbackRes.rows[0]);
    }

    res.json(articleRes.rows[0]);
  } catch (error) {
    console.error('Fetch content feed article error:', error);
    res.status(500).json({ error: 'Internal server error fetching phase article.' });
  }
});

module.exports = router;
