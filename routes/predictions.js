const express = require('express');
const router = express.Router();
const { getDb } = require('../mongodb');
const authMiddleware = require('../middleware/auth');
const { predictCycle } = require('../agents/predictor');

// GET CURRENT PREDICTIONS
router.get('/', authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const database = await getDb();
    const predictionsCol = database.collection('predictions');

    const latestPrediction = await predictionsCol
      .find({ user_id: userId })
      .sort({ created_at: -1 })
      .limit(1)
      .toArray();

    if (latestPrediction.length === 0) {
      // Auto-calculate on the fly if missing (e.g. first login)
      console.log(`No prediction found for user ${userId}. Computing on the fly...`);
      const newPrediction = await predictCycle(userId);
      return res.json(newPrediction);
    }

    // If documents don't have created_at (older records), fall back to returning the first match.
    res.json(latestPrediction[0]);
  } catch (error) {
    console.error('Fetch predictions error:', error);
    res.status(500).json({ error: 'Internal server error fetching cycle predictions.' });
  }
});

module.exports = router;
