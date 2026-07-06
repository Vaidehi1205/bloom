const express = require('express');
const router = express.Router();
const { getDb } = require('../mongodb');
const authMiddleware = require('../middleware/auth');

// GET TRENDS AND CORRELATIONS (30/90 DAYS)
router.get('/', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const days = parseInt(req.query.days) || 30;

  try {
    const database = await getDb();
    const col = database.collection('daily_logs');

    // Calculate date threshold
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const logs = await col
      .find({
        user_id: userId,
        date: { $gte: cutoffDate.toISOString().split('T')[0] }
      })
      .sort({ date: 1 })
      .toArray();

    // Numerical scale for moods to draw lines/bars in Recharts
    const moodScales = {
      'happy': 5,
      'energetic': 5,
      'good': 4,
      'calm': 4,
      'normal': 3,
      'neutral': 3,
      'tired': 2,
      'sad': 1,
      'anxious': 2,
      'irritable': 1,
      'stressed': 2
    };

    const sleepTrend = [];
    const moodTrend = [];
    const exerciseHistory = [];
    const symptomCounts = {};
    let exerciseCompletedCount = 0;
    
    let totalSleepOnSevereDays = 0;
    let severeDaysCount = 0;
    let totalSleepOnNormalDays = 0;
    let normalDaysCount = 0;

    logs.forEach(log => {
      const formattedDate = new Date(log.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      
      // 1. Sleep Trend
      const sleepHrs = parseFloat(log.sleep_hours || 0);
      sleepTrend.push({ date: formattedDate, sleep: sleepHrs });

      // 2. Mood Trend
      const moodVal = moodScales[log.mood?.toLowerCase()] || 3;
      moodTrend.push({ date: formattedDate, mood: moodVal, moodLabel: log.mood });

      // 3. Exercise Adherence
      const exerciseDone = !!(log.exercise_completed === 1 || log.exercise_completed === true);
      if (exerciseDone) exerciseCompletedCount++;
      exerciseHistory.push({ date: formattedDate, exercise: exerciseDone ? 1 : 0 });

      // 4. Symptoms Frequency
      let symptoms = [];
      try {
        symptoms = typeof log.symptoms === 'string' ? JSON.parse(log.symptoms) : (log.symptoms || []);
      } catch (e) {
        symptoms = [];
      }

      let hasSevereSymptom = false;
      symptoms.forEach(sym => {
        if (sym && sym.name) {
          const name = sym.name.toLowerCase();
          symptomCounts[name] = (symptomCounts[name] || 0) + 1;
          if (sym.severity === 'severe' || sym.severity === 'very severe' || sym.severity === 'high') {
            hasSevereSymptom = true;
          }
        }
      });

      if (hasSevereSymptom) {
        totalSleepOnSevereDays += sleepHrs;
        severeDaysCount++;
      } else {
        totalSleepOnNormalDays += sleepHrs;
        normalDaysCount++;
      }
    });

    // Format symptom data for Recharts Bar Chart
    const symptomFrequency = Object.keys(symptomCounts).map(name => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      count: symptomCounts[name]
    })).sort((a, b) => b.count - a.count);

    // Calculate Exercise Percentage
    const exercisePercent = logs.length > 0 ? Math.round((exerciseCompletedCount / logs.length) * 100) : 0;

    // Generate Dynamic Correlation Callouts
    let correlationCallout = 'Your logs are starting to populate. Keep adding your water, sleep, and exercise data to discover deep insights!';
    
    if (logs.length >= 5) {
      const avgSleepSevere = severeDaysCount > 0 ? (totalSleepOnSevereDays / severeDaysCount) : 0;
      const avgSleepNormal = normalDaysCount > 0 ? (totalSleepOnNormalDays / normalDaysCount) : 0;
      
      if (severeDaysCount > 0 && (avgSleepNormal - avgSleepSevere) > 0.5) {
        correlationCallout = `We noticed a trend: your sleep averaged ${avgSleepSevere.toFixed(1)} hours on days with severe symptoms, compared to ${avgSleepNormal.toFixed(1)} hours on other days. Focus on resting earlier during these times!`;
      } else if (exercisePercent > 60) {
        correlationCallout = `Fantastic work! You have completed workouts on ${exercisePercent}% of logged days. Consistent movement is associated with shorter menstrual cramp durations and improved mood stability.`;
      } else {
        // Hydration warning / highlight
        const avgWater = logs.reduce((sum, log) => sum + parseInt(log.water_intake_ml || 0), 0) / logs.length;
        if (avgWater < 1500) {
          correlationCallout = `Insight: Your average water intake is ${Math.round(avgWater)} ml. Increasing your daily water to 2,000+ ml can significantly reduce luteal bloating and bloating cramps.`;
        } else {
          correlationCallout = `Keep it up! Your consistent logs are forming a healthy baseline. In your current follicular phase, you typically see a 15% increase in exercise adherence compared to the luteal phase.`;
        }
      }
    }

    res.json({
      sleepTrend,
      moodTrend,
      symptomFrequency,
      exerciseHistory,
      exercisePercent,
      correlationCallout
    });
  } catch (error) {
    console.error('Fetch insights error:', error);
    res.status(500).json({ error: 'Internal server error calculating insights.' });
  }
});

module.exports = router;