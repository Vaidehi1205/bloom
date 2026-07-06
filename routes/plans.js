const express = require('express');
const router = express.Router();
const { getDb } = require('../mongodb');
const authMiddleware = require('../middleware/auth');
const { generatePlan } = require('../agents/planner');

// GET CURRENT PLAN
router.get('/current', authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const database = await getDb();
    const plansCol = database.collection('plans');

    const latestPlan = await plansCol
      .find({ user_id: userId })
      .sort({ id: -1 })
      .limit(1)
      .toArray();

    if (latestPlan.length === 0) {
      // Auto-generate if missing (defensive fallback)
      console.log(`No plan found for user ${userId}. Auto-generating...`);
      try {
        const newPlan = await generatePlan(userId);
        return res.json(newPlan);
      } catch (err) {
        return res.status(404).json({ error: 'No plan found, and automatic generation failed.' });
      }
    }

    const plan = latestPlan[0];
    let parsedContent;
    try {
      parsedContent = typeof plan.content === 'string' ? JSON.parse(plan.content) : plan.content;
    } catch (e) {
      parsedContent = {};
    }

    res.json({
      id: plan._id?.toString?.() ?? plan._id,
      week_number: plan.week_number,
      type: plan.type,
      content: parsedContent,
      generated_by_agent: plan.generated_by_agent,
      created_at: plan.created_at
    });
  } catch (error) {
    console.error('Fetch current plan error:', error);
    res.status(500).json({ error: 'Internal server error fetching plan.' });
  }
});

// REGENERATE PLAN
router.post('/regenerate', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { adjustment_reason } = req.body;

  try {
    console.log(`Manually triggering plan regeneration for user ${userId}...`);
    const newPlan = await generatePlan(userId, adjustment_reason || 'Manual user request');
    res.json({
      message: 'Plan regenerated successfully.',
      content: newPlan
    });
  } catch (error) {
    console.error('Plan regeneration error:', error);
    res.status(500).json({ error: 'Internal server error regenerating plan.' });
  }
});

module.exports = router;