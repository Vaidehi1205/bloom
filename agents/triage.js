const { getDb } = require('../mongodb');

/**
 * Runs triage logic on a user's recent logs to scan for wellness anomalies.
 * @param {number} userId
 */
async function runTriage(userId) {
  try {
    let anomalyDetected = false;
    const reasons = [];

    const database = await getDb();

    // 1. Check Cycle Logs anomalies (cycle length deviation)
    const logs = await database.collection('cycle_logs')
      .find({ user_id: userId })
      .sort({ period_start: -1 })
      .limit(4)
      .toArray();

    if (logs.length >= 2) {
      // Calculate length of the last cycle
      const lastStart = new Date(logs[0].period_start);
      const prevStart = new Date(logs[1].period_start);
      const lastCycleLength = Math.round((lastStart - prevStart) / (1000 * 60 * 60 * 24));

      if (lastCycleLength < 21) {
        anomalyDetected = true;
        reasons.push(`Short cycle length logged (${lastCycleLength} days).`);
      } else if (lastCycleLength > 35) {
        anomalyDetected = true;
        reasons.push(`Long cycle length logged (${lastCycleLength} days).`);
      }
    }

    // 2. Check Daily Logs for repeated severe symptoms in last 14 days
    const dailyLogs = await database.collection('daily_logs')
      .find({ user_id: userId })
      .sort({ date: -1 })
      .limit(14)
      .toArray();

    let severeCount = 0;
    const severeSymptoms = [];

    dailyLogs.forEach(log => {
      let symptoms = [];
      try {
        symptoms = typeof log.symptoms === 'string' ? JSON.parse(log.symptoms) : (log.symptoms || []);
      } catch (e) {
        symptoms = [];
      }

      symptoms.forEach(sym => {
        // e.g. symptom object format: { name: 'cramps', severity: 'severe' }
        if (sym && (sym.severity === 'severe' || sym.severity === 'very severe' || sym.severity === 'high')) {
          severeCount++;
          if (!severeSymptoms.includes(sym.name)) {
            severeSymptoms.push(sym.name);
          }
        }
      });
    });

    if (severeCount >= 3) {
      anomalyDetected = true;
      reasons.push(`Frequent severe symptoms logged (${severeSymptoms.join(', ')} reported ${severeCount} times recently).`);
    }

    // 3. Trigger alert notification if anomalies were found
    if (anomalyDetected) {
      const message = `Health Triage Notice: We noticed a pattern in your logging (${reasons.join(' ')}). Please consider consulting with a healthcare provider for professional support. Bloom is a wellness companion and does not provide diagnoses.`;

      // Check if a triage warning has been sent in the last 7 days to avoid alert fatigue
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const recentNotifs = await database.collection('notifications')
        .find({
          user_id: userId,
          type: 'triage_warning',
          scheduled_for: { $gt: cutoff }
        })
        .limit(1)
        .toArray();

      if (recentNotifs.length === 0) {
        const scheduledTime = new Date().toISOString();
        await database.collection('notifications').insertOne({
          user_id: userId,
          type: 'triage_warning',
          message,
          scheduled_for: scheduledTime,
          sent_at: scheduledTime,
          created_at: new Date()
        });

        console.log(`Triage alert generated for user ID ${userId}`);
      }

      // Log triage execution audit details
      const actionSummary = `Triage flagged potential health irregularities: ${reasons.join(' ')}`;
      await database.collection('agent_actions').insertOne({
        user_id: userId,
        agent_name: 'Triage Agent',
        trigger_type: 'log_triage_check',
        action_taken: 'Generated warning notification',
        reasoning_summary: actionSummary,
        created_at: new Date()
      });
    } else {
      // Log normal checks once in a while to keep trace
      await database.collection('agent_actions').insertOne({
        user_id: userId,
        agent_name: 'Triage Agent',
        trigger_type: 'log_triage_check',
        action_taken: 'No action needed',
        reasoning_summary: 'Logs reviewed. All metrics inside standard parameters.',
        created_at: new Date()
      });
    }

    return { anomalyDetected, reasons };
  } catch (error) {
    console.error('Triage Agent error:', error);
    throw error;
  }
}

module.exports = {
  runTriage
};
