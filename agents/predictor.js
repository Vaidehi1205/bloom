const { getDb } = require('../mongodb');

/**
 * Predicts the user's cycle phase and next period date.
 * Runs deterministically to ensure maximum calculation accuracy, logging via the agent.
 * @param {number} userId
 */
async function predictCycle(userId) {
  try {
    // 1. Fetch cycle logs
    const database = await getDb();
    const logsCol = database.collection('cycle_logs');
    const logs = await logsCol
      .find({ user_id: userId })
      .sort({ period_start: -1 })
      .toArray();

    let averageCycleLength = 28; // Default cycle length
    let averagePeriodDuration = 5; // Default period duration
    let lastPeriodStart = null;
    let confidence = 0.5; // Confidence starts at 50% for defaults

    if (logs.length > 0) {
      lastPeriodStart = new Date(logs[0].period_start);
      
      // Calculate durations
      const durations = [];
      logs.forEach(log => {
        const start = new Date(log.period_start);
        const end = new Date(log.period_end);
        const duration = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
        if (duration > 0 && duration < 15) {
          durations.push(duration);
        }
      });
      if (durations.length > 0) {
        averagePeriodDuration = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
      }

      // Calculate cycle lengths (days between consecutive starts)
      const cycleLengths = [];
      for (let i = 0; i < logs.length - 1; i++) {
        const currentStart = new Date(logs[i].period_start);
        const prevStart = new Date(logs[i + 1].period_start);
        const cycle = Math.round((currentStart - prevStart) / (1000 * 60 * 60 * 24));
        if (cycle > 15 && cycle < 45) {
          cycleLengths.push(cycle);
        }
      }

      if (cycleLengths.length > 0) {
        averageCycleLength = Math.round(cycleLengths.reduce((a, b) => a + b, 0) / cycleLengths.length);
        confidence = Math.min(0.5 + 0.15 * cycleLengths.length, 0.95); // Higher count = higher confidence
      } else {
        confidence = 0.7; // Moderate confidence with single log
      }
    }

    // 2. Predict next cycle details
    let predictedNextPeriodDate = new Date();
    let currentPhase = 'follicular'; // Default standard phase

    if (lastPeriodStart) {
      // predicted_next_period = lastPeriodStart + averageCycleLength
      predictedNextPeriodDate = new Date(lastPeriodStart.getTime());
      predictedNextPeriodDate.setDate(predictedNextPeriodDate.getDate() + averageCycleLength);

      // Determine phase based on current date
      const today = new Date();
      const diffTime = today - lastPeriodStart;
      const daysSinceStart = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      if (daysSinceStart < 0) {
        // If last period was logged in the future (unlikely but safe check)
        currentPhase = 'menstrual';
      } else {
        const cycleDay = daysSinceStart % averageCycleLength;
        if (cycleDay < averagePeriodDuration) {
          currentPhase = 'menstrual';
        } else if (cycleDay < Math.floor(averageCycleLength * 0.45)) {
          // days duration -> 12/13
          currentPhase = 'follicular';
        } else if (cycleDay < Math.floor(averageCycleLength * 0.55)) {
          // days 13 -> 15 (around ovulation)
          currentPhase = 'ovulation';
        } else {
          // days 16 -> end
          currentPhase = 'luteal';
        }
      }
    } else {
      // No cycle logs: assume today is day 7 of follicular phase
      const today = new Date();
      predictedNextPeriodDate = new Date(today.getTime());
      predictedNextPeriodDate.setDate(predictedNextPeriodDate.getDate() + 21); // 21 days from now
      currentPhase = 'follicular';
      confidence = 0.3; // Low confidence
    }

    const predictedNextPeriodStr = predictedNextPeriodDate.toISOString().split('T')[0];

    // 3. Write predictions (overwrite existing user prediction)
    await database.collection('predictions').deleteMany({ user_id: userId });
    await database.collection('predictions').insertOne({
      user_id: userId,
      predicted_next_period: predictedNextPeriodStr,
      predicted_phase: currentPhase,
      confidence
    });

    // 4. Log to agent actions
    const summary = `Predictor Agent completed nightly analysis. Predicted next period date: ${predictedNextPeriodStr}, current phase: ${currentPhase}, confidence: ${(confidence * 100).toFixed(0)}%.`;
    await database.collection('agent_actions').insertOne({
      user_id: userId,
      agent_name: 'Predictor Agent',
      trigger_type: 'nightly_cron',
      action_taken: 'Cycle tracking prediction updated',
      reasoning_summary: summary,
      created_at: new Date()
    });

    return {
      predicted_next_period: predictedNextPeriodStr,
      predicted_phase: currentPhase,
      confidence
    };
  } catch (error) {
    console.error('Predictor Agent error:', error);
    throw error;
  }
}

/**
 * Runs cycle prediction for all users. Used in nightly cron schedules.
 */
async function predictAllUsers() {
  try {
    const database = await getDb();
    const users = await database.collection('users').find({}, { projection: { id: 1 } }).toArray();
    console.log(`Predictor running for ${users.length} users...`);
    for (const u of users) {
      await predictCycle(u.id);
    }
    console.log('All user predictions completed.');
  } catch (error) {
    console.error('Failed to run batch predictions:', error);
  }
}

module.exports = {
  predictCycle,
  predictAllUsers
};
