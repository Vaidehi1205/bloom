const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { generatePlan } = require('../agents/planner');
const { getFirestore, admin, initialized: firebaseInitialized } = require('../firebase');

function buildProfilePayload(data) {
  return {
    age: Number(data.age),
    height_cm: Number(data.height_cm),
    weight_kg: Number(data.weight_kg),
    activity_level: data.activity_level,
    dietary_preference: data.dietary_preference,
    medical_conditions: Array.isArray(data.medical_conditions)
      ? data.medical_conditions
      : (data.medical_conditions ? String(data.medical_conditions).split(',').map(item => item.trim()).filter(Boolean) : []),
    updated_at: admin.firestore.FieldValue.serverTimestamp()
  };
}

// GET PROFILE
router.get('/', authMiddleware, async (req, res) => {
  try {
    if (!firebaseInitialized) {
      return res.status(500).json({ error: 'Firebase Admin is not initialized. Check your Firebase credentials or GOOGLE_APPLICATION_CREDENTIALS.' });
    }

    const firestore = getFirestore();
    const profileDoc = firestore.collection('users').doc(req.user.firebaseUid).collection('profile').doc('main');
    const snapshot = await profileDoc.get();

    if (!snapshot.exists) {
      return res.status(404).json({ message: 'Profile not found. Onboarding required.' });
    }

    return res.json(snapshot.data());
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
    if (!firebaseInitialized) {
      return res.status(500).json({ error: 'Firebase Admin is not initialized. Check your Firebase credentials or GOOGLE_APPLICATION_CREDENTIALS.' });
    }

    const payload = buildProfilePayload({ age, height_cm, weight_kg, activity_level, dietary_preference, medical_conditions });
    const firestore = getFirestore();
    const profileDoc = firestore.collection('users').doc(req.user.firebaseUid).collection('profile').doc('main');
    await profileDoc.set(payload, { merge: true });

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
