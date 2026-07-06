const express = require('express');
const router = express.Router();
const { getDb } = require('../mongodb');
const authMiddleware = require('../middleware/auth');

// GET PHASE-AWARE ARTICLE
router.get('/', authMiddleware, async (req, res) => {
  const { phase, locale } = req.query;

  if (!phase) {
    return res.status(400).json({ error: 'Phase query parameter is required.' });
  }

  const queryLocale = locale || req.user.locale || 'en';

  try {
    const database = await getDb();
    const col = database.collection('content_feed');

    let article = await col.findOne({
      phase_tag: phase.toLowerCase(),
      locale: queryLocale
    });

    if (!article) {
      // Fallback: try finding English article for the phase
      article = await col.findOne({
        phase_tag: phase.toLowerCase(),
        locale: 'en'
      });
      if (!article) {
        return res.status(404).json({ error: 'No article found for this cycle phase.' });
      }
    }

    res.json({
      id: article._id?.toString?.() ?? article._id,
      ...article
    });
  } catch (error) {
    console.error('Fetch content feed article error:', error);
    res.status(500).json({ error: 'Internal server error fetching phase article.' });
  }
});

module.exports = router;