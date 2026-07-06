const express = require('express');
const router = express.Router();
const { getDb } = require('../mongodb');
const authMiddleware = require('../middleware/auth');

// GET CURRENT LOCALE
router.get('/locale', authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const database = await getDb();
    const col = database.collection('users');

    const user = await col.findOne(
      { id: userId },
      { projection: { locale: 1 } }
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ locale: user.locale || 'en' });
  } catch (error) {
    console.error('Fetch settings locale error:', error);
    res.status(500).json({ error: 'Internal server error fetching locale.' });
  }
});

// UPDATE LOCALE
router.put('/locale', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { locale } = req.body;

  if (!locale) {
    return res.status(400).json({ error: 'Locale value is required.' });
  }

  try {
    const database = await getDb();
    const col = database.collection('users');

    await col.updateOne(
      { id: userId },
      { $set: { locale } },
      { upsert: true }
    );

    res.json({ message: 'Language settings updated successfully.', locale });
  } catch (error) {
    console.error('Update settings locale error:', error);
    res.status(500).json({ error: 'Internal server error updating locale.' });
  }
});

module.exports = router;