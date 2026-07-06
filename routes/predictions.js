const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const { predictCycle } = require('../agents/predictor');

// GET CURRENT PREDICTIONS
router.get('/', authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const predictionsRes = await db.query(
      'SELECT * FROM predictions WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
      [userId]
    );

    if (predictionsRes.rows.length === 0) {
      // Auto-calculate on the fly if missing (e.g. first login)
      console.log(`No prediction found for user ${userId}. Computing on the fly...`);
      const newPrediction = await predictCycle(userId);
      return res.json(newPrediction);
    }

    res.json(predictionsRes.rows[0]);
  } catch (error) {
    console.error('Fetch predictions error:', error);
    res.status(500).json({ error: 'Internal server error fetching cycle predictions.' });
  }
});

module.exports = router;
