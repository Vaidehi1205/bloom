const express = require('express');
const router = express.Router();
const { getDb } = require('../mongodb');
const authMiddleware = require('../middleware/auth');
const { runTriage } = require('../agents/triage');

function normalizeSymptoms(symptoms) {
  if (!symptoms) return [];
  // Frontend sends an array of {name, severity}
  if (Array.isArray(symptoms)) return symptoms;
  // In case something stored JSON-stringified
  if (typeof symptoms === 'string') {
    try {
      const parsed = JSON.parse(symptoms);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

// GET DAILY LOGS
router.get('/', authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const database = await getDb();
    const col = database.collection('daily_logs');

    const logs = await col
      .find({ user_id: userId })
      .sort({ date: -1 })
      .limit(30)
      .toArray();

    res.json(
      logs.map((d) => ({
        id: d._id?.toString?.() ?? d._id,
        ...d,
        symptoms: normalizeSymptoms(d.symptoms),
      }))
    );
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
    const database = await getDb();
    const col = database.collection('daily_logs');

    const completed = exercise_completed ? 1 : 0;
    const normalizedSymptoms = normalizeSymptoms(symptoms);

    await col.updateOne(
      { user_id: userId, date },
      {
        $set: {
          water_intake_ml: parseInt(water_intake_ml),
          exercise_completed: completed,
          sleep_hours: parseFloat(sleep_hours),
          mood,
          symptoms: normalizedSymptoms,
        },
      },
      { upsert: true }
    );

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

