const { getDb } = require('../mongodb');
const { callClaude } = require('./claude');

/**
 * Generates or adjusts a weekly wellness plan for a user.
 * @param {number} userId
 * @param {string} adjustmentReason - optional context (e.g. "user reports fatigue")
 */
async function generatePlan(userId, adjustmentReason = '') {
  try {
    // 1. Retrieve user data
    const database = await getDb();
    const usersCol = database.collection('users');
    const profileCol = database.collection('profile');
    const logsCol = database.collection('daily_logs');
    const predictionsCol = database.collection('predictions');
    const plansCol = database.collection('plans');
    const agentActionsCol = database.collection('agent_actions');

    const user = await usersCol.findOne({ id: userId });
    if (!user) throw new Error('User not found');

    const profile = await profileCol.findOne({ user_id: userId });
    const prediction = await predictionsCol.findOne(
      { user_id: userId },
      { sort: { created_at: -1 } }
    );

    const logs = await logsCol
      .find({ user_id: userId })
      .sort({ date: -1 })
      .limit(7)
      .toArray();

    // Parse profile conditions and logs
    let medicalConditions = [];
    try {
      medicalConditions = typeof profile?.medical_conditions === 'string'
        ? JSON.parse(profile.medical_conditions)
        : (profile?.medical_conditions || []);
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
- Age: ${profile?.age || 'Unknown'}
- Height: ${profile?.height_cm || 'Unknown'} cm
- Weight: ${profile?.weight_kg || 'Unknown'} kg
- Activity Level: ${profile?.activity_level || 'Moderate'}
- Dietary Preference: ${profile?.dietary_preference || 'None'}
- Medical Conditions: ${JSON.stringify(medicalConditions)}
- Current Cycle Phase: ${prediction?.predicted_phase || 'follicular'}
- Predicted Next Period: ${prediction?.predicted_next_period || 'Not calculated'}

Recent Logs (last 7 entries):
${JSON.stringify(logs.map(l => ({ date: l.date, water: l.water_intake_ml, sleep: l.sleep_hours, mood: l.mood, symptoms: l.symptoms })))}

Adjustment Context/Request:
${adjustmentReason ? `"${adjustmentReason}"` : 'Routine weekly check/onboarding.'}

Please tailor the diet and exercise to support their current cycle phase (${prediction?.predicted_phase || 'follicular'}).
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
    await plansCol.deleteMany({ user_id: userId, week_number: currentWeekNumber });

    // Insert new plan
    await plansCol.insertOne({
      user_id: userId,
      week_number: currentWeekNumber,
      type: 'unified',
      content: contentString,
      generated_by_agent: 1,
      created_at: new Date()
    });

    // 5. Log agent action
    const actionSummary = `Generated unified weekly plan (diet/exercise) customized for ${prediction?.predicted_phase || 'follicular'} phase.${adjustmentReason ? ` Reason: ${adjustmentReason}` : ''}`;
    await agentActionsCol.insertOne({
      user_id: userId,
      agent_name: 'Planner Agent',
      trigger_type: adjustmentReason ? 'user_request' : 'onboarding_or_schedule',
      action_taken: actionSummary,
      reasoning_summary: JSON.stringify(parsedPlan),
      created_at: new Date()
    });

    return parsedPlan;
  } catch (error) {
    console.error('Planner Agent error:', error);
    throw error;
  }
}

module.exports = {
  generatePlan
};