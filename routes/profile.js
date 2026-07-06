const express = require('express');
const router = express.Router();
const { getDb } = require('../mongodb');
const authMiddleware = require('../middleware/auth');
const { generatePlan } = require('../agents/planner');

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
    const database = await getDb();
    const col = database.collection('profile');

    const profile = await col.findOne({ user_id: userId });

    if (!profile) {
      return res.status(404).json({ message: 'Profile not found. Onboarding required.' });
    }

    return res.json({
      id: profile._id?.toString?.() ?? profile._id,
      ...profile
    });
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
    const userId = req.user.id;
    const database = await getDb();
    const col = database.collection('profile');

    await col.updateOne(
      { user_id: userId },
      {
        $set: {
          user_id: userId,
          age: payload.age,
          height_cm: payload.height_cm,
          weight_kg: payload.weight_kg,
          activity_level: payload.activity_level,
          dietary_preference: payload.dietary_preference,
          medical_conditions: payload.medical_conditions
        }
      },
      { upsert: true }
    );

    let initialPlan = null;
    if (trigger_plan) {
      try {
        initialPlan = await generatePlan(userId);
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