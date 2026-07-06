const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const { runTriage } = require('../agents/triage');

// GET DAILY LOGS
router.get('/', authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const logsRes = await db.query(
      'SELECT * FROM daily_logs WHERE user_id = $1 ORDER BY date DESC LIMIT 30',
      [userId]
    );

    const logs = logsRes.rows.map(log => {
      try {
        log.symptoms = typeof log.symptoms === 'string'
          ? JSON.parse(log.symptoms)
          : (log.symptoms || []);
      } catch (e) {
        log.symptoms = [];
      }
      return log;
    });

    res.json(logs);
  } catch (error) {
    console.error('Fetch daily logs error:', error);
    res.status(500).json({ error: 'Internal server error fetching daily logs.' });
  }
});

// POST DAILY LOG
router.post('/', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { date, water_intake_ml, exercise_completed, sleep_hours, mood, symptoms } = req.body;

  if (!date || water_intake_ml === undefined || sleep_hours === undefined || !mood) {
    return res.status(400).json({ error: 'Date, water intake, sleep hours, and mood are required.' });
  }

  try {
    const symptomsStr = JSON.stringify(symptoms || []);
    const completed = exercise_completed ? 1 : 0;

    // Check if entry for this date already exists
    const checkRes = await db.query(
      'SELECT id FROM daily_logs WHERE user_id = $1 AND date = $2',
      [userId, date]
    );

    if (checkRes.rows.length > 0) {
      // Update
      await db.query(
        'UPDATE daily_logs SET water_intake_ml = $1, exercise_completed = $2, sleep_hours = $3, mood = $4, symptoms = $5 WHERE user_id = $6 AND date = $7',
        [parseInt(water_intake_ml), completed, parseFloat(sleep_hours), mood, symptomsStr, userId, date]
      );
    } else {
      // Insert
      await db.query(
        'INSERT INTO daily_logs (user_id, date, water_intake_ml, exercise_completed, sleep_hours, mood, symptoms) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [userId, date, parseInt(water_intake_ml), completed, parseFloat(sleep_hours), mood, symptomsStr]
      );
    }

    // Trigger Triage check
    try {
      await runTriage(userId);
    } catch (triageErr) {
      console.error('Triage check failed after logging daily activity:', triageErr);
    }

    res.status(201).json({ message: 'Daily activity log saved successfully.' });
  } catch (error) {
    console.error('Save daily log error:', error);
    res.status(500).json({ error: 'Internal server error saving daily log.' });
  }
});

module.exports = router;
