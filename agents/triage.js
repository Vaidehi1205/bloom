const db = require('../db');

/**
 * Runs triage logic on a user's recent logs to scan for wellness anomalies.
 * @param {number} userId
 */
async function runTriage(userId) {
  try {
    let anomalyDetected = false;
    const reasons = [];

    // 1. Check Cycle Logs anomalies (cycle length deviation)
    const logsRes = await db.query(
      'SELECT * FROM cycle_logs WHERE user_id = $1 ORDER BY period_start DESC LIMIT 4',
      [userId]
    );
    const logs = logsRes.rows;

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

    // 2. Check Daily Logs for repeated severe symptoms (e.g., severe cramps, severe headaches) in last 14 days
    const dailyLogsRes = await db.query(
      'SELECT * FROM daily_logs WHERE user_id = $1 ORDER BY date DESC LIMIT 14',
      [userId]
    );
    const dailyLogs = dailyLogsRes.rows;

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
      const recentNotifRes = await db.query(
        "SELECT id FROM notifications WHERE user_id = $1 AND type = 'triage_warning' AND scheduled_for > CURRENT_TIMESTAMP - INTERVAL '7 days'",
        [userId]
      );
      
      const sqliteRecentNotifRes = await db.query(
        "SELECT id FROM notifications WHERE user_id = $1 AND type = 'triage_warning' AND datetime(scheduled_for) > datetime('now', '-7 days')",
        [userId]
      ).catch(() => null); // Fallback if postgres interval fails on SQLite or vice versa

      const recentNotifs = (sqliteRecentNotifRes && sqliteRecentNotifRes.rows) || recentNotifRes.rows;

      if (recentNotifs.length === 0) {
        // Insert notification
        const scheduledTime = new Date().toISOString();
        await db.query(
          'INSERT INTO notifications (user_id, type, message, scheduled_for, sent_at) VALUES ($1, $2, $3, $4, $5)',
          [userId, 'triage_warning', message, scheduledTime, scheduledTime]
        );
        
        console.log(`Triage alert generated for user ID ${userId}`);
      }

      // Log triage execution audit details
      const actionSummary = `Triage flagged potential health irregularities: ${reasons.join(' ')}`;
      await db.query(
        'INSERT INTO agent_actions (user_id, agent_name, trigger_type, action_taken, reasoning_summary) VALUES ($1, $2, $3, $4, $5)',
        [userId, 'Triage Agent', 'log_triage_check', 'Generated warning notification', actionSummary]
      );
    } else {
      // Log normal checks once in a while to keep trace
      await db.query(
        'INSERT INTO agent_actions (user_id, agent_name, trigger_type, action_taken, reasoning_summary) VALUES ($1, $2, $3, $4, $5)',
        [userId, 'Triage Agent', 'log_triage_check', 'No action needed', 'Logs reviewed. All metrics inside standard parameters.']
      );
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
