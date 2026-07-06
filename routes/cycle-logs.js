const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const { predictCycle } = require('../agents/predictor');
const { runTriage } = require('../agents/triage');

// GET CYCLE LOGS
router.get('/', authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const logsRes = await db.query(
      'SELECT * FROM cycle_logs WHERE user_id = $1 ORDER BY period_start DESC',
      [userId]
    );
    res.json(logsRes.rows);
  } catch (error) {
    console.error('Fetch cycle logs error:', error);
    res.status(500).json({ error: 'Internal server error fetching cycle logs.' });
  }
});

// POST CYCLE LOG
router.post('/', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { period_start, period_end, flow_intensity, notes } = req.body;

  if (!period_start || !period_end || !flow_intensity) {
    return res.status(400).json({ error: 'Period start, end, and flow intensity are required.' });
  }

  try {
    // Insert the log
      await db.query(
        'INSERT INTO cycle_logs (user_id, period_start, period_end, flow_intensity, notes) VALUES ($1, $2, $3, $4, $5)',
        [userId, period_start, period_end, flow_intensity, notes || '']
      );

    // Proactively run predictor to update the phase for the dashboard immediately
    let predictionResult = null;
    try {
      predictionResult = await predictCycle(userId);
    } catch (predErr) {
      console.error('Predictor failed after logging cycle:', predErr);
    }

    // Proactively run triage checks
    try {
      await runTriage(userId);
    } catch (triageErr) {
      console.error('Triage check failed after logging cycle:', triageErr);
    }

    res.status(201).json({
      message: 'Cycle log saved successfully.',
      prediction: predictionResult
    });
  } catch (error) {
    console.error('Save cycle log error:', error);
    res.status(500).json({ error: 'Internal server error saving cycle log.' });
  }
});

module.exports = router;
