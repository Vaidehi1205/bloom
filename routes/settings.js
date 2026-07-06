const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middleware/auth');

// GET CURRENT LOCALE
router.get('/locale', authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const userRes = await db.query('SELECT locale FROM users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ locale: userRes.rows[0].locale });
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
    await db.query('UPDATE users SET locale = $1 WHERE id = $2', [locale, userId]);
    res.json({ message: 'Language settings updated successfully.', locale });
  } catch (error) {
    console.error('Update settings locale error:', error);
    res.status(500).json({ error: 'Internal server error updating locale.' });
  }
});

module.exports = router;
