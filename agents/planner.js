const db = require('../db');
const { callClaude } = require('./claude');

/**
 * Generates or adjusts a weekly wellness plan for a user.
 * @param {number} userId
 * @param {string} adjustmentReason - optional context (e.g. "user reports fatigue")
 */
async function generatePlan(userId, adjustmentReason = '') {
  try {
    // 1. Retrieve user data
    const userRes = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) throw new Error('User not found');
    const user = userRes.rows[0];

    const profileRes = await db.query('SELECT * FROM profile WHERE user_id = $1', [userId]);
    const profile = profileRes.rows[0] || {};

    const logsRes = await db.query('SELECT * FROM daily_logs WHERE user_id = $1 ORDER BY date DESC LIMIT 7', [userId]);
    const logs = logsRes.rows;

    const predictionRes = await db.query('SELECT * FROM predictions WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [userId]);
    const prediction = predictionRes.rows[0] || { predicted_phase: 'follicular', predicted_next_period: 'Not calculated' };

    // Parse profile conditions and logs
    let medicalConditions = [];
    try {
      medicalConditions = typeof profile.medical_conditions === 'string' 
        ? JSON.parse(profile.medical_conditions) 
        : (profile.medical_conditions || []);
    } catch (e) {
      medicalConditions = [];
    }

    // 2. Formulate Prompt
    const systemPrompt = `You are the Bloom Planner Agent, a supportive and professional expert in women's health, nutrition, and exercise.
Your job is to generate a personalized weekly diet and exercise plan for a user.
The plan must be structured as JSON. Do not include any formatting, markdown, or chat outside of the JSON block.

The JSON schema MUST match:
{
  "diet": {
    "breakfast": "...",
    "lunch": "...",
    "dinner": "...",
    "snack": "...",
    "hydration": "..."
  },
  "exercise": {
    "workouts": [
      { "day": "Monday", "routine": "..." },
      { "day": "Wednesday", "routine": "..." },
      { "day": "Friday", "routine": "..." }
    ],
    "notes": "..."
  },
  "disclaimer": "This plan is a general wellness guideline and should not replace medical advice."
}`;

    const userPrompt = `
User Profile:
- Age: ${profile.age || 'Unknown'}
- Height: ${profile.height_cm || 'Unknown'} cm
- Weight: ${profile.weight_kg || 'Unknown'} kg
- Activity Level: ${profile.activity_level || 'Moderate'}
- Dietary Preference: ${profile.dietary_preference || 'None'}
- Medical Conditions: ${JSON.stringify(medicalConditions)}
- Current Cycle Phase: ${prediction.predicted_phase}
- Predicted Next Period: ${prediction.predicted_next_period}

Recent Logs (last 7 entries):
${JSON.stringify(logs.map(l => ({ date: l.date, water: l.water_intake_ml, sleep: l.sleep_hours, mood: l.mood, symptoms: l.symptoms })))}

Adjustment Context/Request:
${adjustmentReason ? `"${adjustmentReason}"` : 'Routine weekly check/onboarding.'}

Please tailor the diet and exercise to support their current cycle phase (${prediction.predicted_phase}).
If the user reports feeling tired, exhausted, or in pain, reduce the intensity of workouts and recommend highly restorative meals and hydration.
Return only the raw JSON.`;

    // 3. Call AI
    const result = await callClaude({
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const contentText = result.content[0].text;
    
    // Attempt parsing to verify valid JSON
    let parsedPlan;
    try {
      parsedPlan = JSON.parse(contentText.trim());
    } catch (err) {
      console.warn('Claude failed to output raw JSON, attempting custom extraction:', err);
      // fallback matching regex to extract JSON blocks
      const jsonMatch = contentText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedPlan = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse AI plan response');
      }
    }

    // 4. Save to Database
    const currentWeekNumber = 1; // Simplify to week 1 for general dashboard tracker
    
    // Store as JSON string in both db types for compatibility
    const contentString = JSON.stringify(parsedPlan);

    // Delete existing current week plans of same types
    await db.query('DELETE FROM plans WHERE user_id = $1 AND week_number = $2', [userId, currentWeekNumber]);

    // Insert new plan
    await db.query(
      'INSERT INTO plans (user_id, week_number, type, content, generated_by_agent) VALUES ($1, $2, $3, $4, $5)',
      [userId, currentWeekNumber, 'unified', contentString, 1]
    );

    // 5. Log agent action
    const actionSummary = `Generated unified weekly plan (diet/exercise) customized for ${prediction.predicted_phase} phase.${adjustmentReason ? ` Reason: ${adjustmentReason}` : ''}`;
    await db.query(
      'INSERT INTO agent_actions (user_id, agent_name, trigger_type, action_taken, reasoning_summary) VALUES ($1, $2, $3, $4, $5)',
      [userId, 'Planner Agent', adjustmentReason ? 'user_request' : 'onboarding_or_schedule', actionSummary, JSON.stringify(parsedPlan)]
    );

    return parsedPlan;
  } catch (error) {
    console.error('Planner Agent error:', error);
    throw error;
  }
}

module.exports = {
  generatePlan
};
