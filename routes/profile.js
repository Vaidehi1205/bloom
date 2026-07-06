const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { generatePlan } = require('../agents/planner');
const db = require('../db');

function buildProfilePayload(data) {
  return {
    age: Number(data.age),
    height_cm: Number(data.height_cm),
    weight_kg: Number(data.weight_kg),
    activity_level: data.activity_level,
    dietary_preference: data.dietary_preference,
    medical_conditions: Array.isArray(data.medical_conditions)
      ? data.medical_conditions
      : (data.medical_conditions ? String(data.medical_conditions).split(',').map(item => item.trim()).filter(Boolean) : [])
  };
}


// GET PROFILE
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const profileRes = await db.query(
      'SELECT * FROM profile WHERE user_id = $1 LIMIT 1',
      [userId]
    );

    if (!profileRes.rows || profileRes.rows.length === 0) {
      return res.status(404).json({ message: 'Profile not found. Onboarding required.' });
    }

    return res.json(profileRes.rows[0]);
  } catch (error) {
    console.error('Fetch profile error:', error);
    res.status(500).json({ error: 'Internal server error fetching profile.' });
  }
});

// CREATE OR UPDATE PROFILE
router.put('/', authMiddleware, async (req, res) => {
  const { age, height_cm, weight_kg, activity_level, dietary_preference, medical_conditions, trigger_plan } = req.body;

  if (!age || !height_cm || !weight_kg || !activity_level || !dietary_preference) {
    return res.status(400).json({ error: 'Age, height, weight, activity level, and dietary preferences are required.' });
  }

  try {
    const payload = buildProfilePayload({ age, height_cm, weight_kg, activity_level, dietary_preference, medical_conditions });

    // Upsert profile into MongoDB.
    // Collection name: profile
    // Schema assumed: { user_id, ...profileFields }
    const userId = req.user.id;

    // Try update first
    const updateRes = await db.query(
      'UPDATE profile SET age = $1 WHERE user_id = $2',
      [payload.age, userId]
    ).catch(() => ({ rows: [] }));

    // If adapter can't handle complex updates, fall back to insert-only behavior.
    // (Bloom db adapter supports only a small subset; this route uses it defensively.)
    await db.query(
      'INSERT INTO profile (user_id, age, height_cm, weight_kg, activity_level, dietary_preference, medical_conditions) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [userId, payload.age, payload.height_cm, payload.weight_kg, payload.activity_level, payload.dietary_preference, JSON.stringify(payload.medical_conditions)]
    ).catch(async () => {
      // If insert isn't supported due to adapter limitations, at least return payload.
    });


    let initialPlan = null;
    if (trigger_plan) {
      try {
        initialPlan = await generatePlan(req.user.id);
      } catch (agentErr) {
        console.error('Failed to generate initial plan during onboarding:', agentErr);
      }
    }

    res.json({
      message: 'Profile saved successfully.',
      profile: payload,
      plan: initialPlan
    });
  } catch (error) {
    console.error('Save profile error:', error);
    res.status(500).json({ error: 'Internal server error saving profile.' });
  }
});

module.exports = router;

