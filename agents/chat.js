const { getDb } = require('../mongodb');
const { callClaude } = require('./claude');
const { generatePlan } = require('./planner');

/**
 * Handle chat conversation and coordinate planning tool calls.
 * @param {number} userId
 * @param {Array} messageHistory - List of previous messages [{ role: 'user'|'assistant', content: '...' }]
 */
async function handleChat(userId, messageHistory) {
  try {
    // 1. Fetch current profile & predictions for context
    const database = await getDb();
    const profileCol = database.collection('profile');
    const predictionsCol = database.collection('predictions');
    const agentActionsCol = database.collection('agent_actions');

    const profile = await profileCol.findOne({ user_id: userId });
    const prediction = await predictionsCol.findOne(
      { user_id: userId },
      { sort: { created_at: -1 } }
    );

    const systemPrompt = `You are the Bloom Health Assistant, a friendly, warm, empathetic, and supportive digital companion for menstrual health and wellness. 
You answer general questions about periods, symptoms, sleep, hydration, nutrition, and exercise.

GUIDELINES:
1. Provide encouraging, evidence-based wellness tips. 
2. ALWAYS include a brief, soft disclaimer that you are an AI wellness helper and do not provide medical advice if the user asks about physical symptoms or severe pain.
3. If the user expresses fatigue, soreness, pain, or explicitly asks to change/adjust their current exercise or diet plan, you MUST invoke the tool 'regenerate_plan' to update their plan. Do not just promise it; invoke the tool.

User Context:
- Current Cycle Phase: ${prediction?.predicted_phase || 'follicular'}
- Dietary Preference: ${profile?.dietary_preference || 'None'}
- Medical Conditions: ${profile?.medical_conditions || 'None'}`;

    const tools = [
      {
        name: 'regenerate_plan',
        description: 'Regenerate the user\'s weekly diet and exercise plan to adjust for fatigue, pain, or specific user feedback.',
        input_schema: {
          type: 'object',
          properties: {
            adjustment_reason: {
              type: 'string',
              description: 'The specific feedback or state from the user explaining why they want to adjust their plan (e.g., "feels too tired", "wants vegan meals").'
            }
          },
          required: ['adjustment_reason']
        }
      }
    ];

    // 2. Call Claude
    const response = await callClaude({
      systemPrompt,
      messages: messageHistory,
      tools
    });

    const contentBlocks = response.content;
    let assistantMessage = '';
    let toolUseBlock = null;

    for (const block of contentBlocks) {
      if (block.type === 'text') {
        assistantMessage += block.text + '\n';
      } else if (block.type === 'tool_use' && block.name === 'regenerate_plan') {
        toolUseBlock = block;
      }
    }

    // 3. Handle Tool Use if generated
    if (toolUseBlock) {
      const { adjustment_reason } = toolUseBlock.input;
      console.log(`Chat Agent triggering Planner Agent tool for user ${userId}. Reason: ${adjustment_reason}`);

      // Call Planner Agent to rebuild the plan in the database
      const newPlan = await generatePlan(userId, adjustment_reason);

      assistantMessage += `\n[System Update: I've updated your weekly plan based on your current state ("${adjustment_reason}"). You can see your new workout and nutrition guidelines on the Plan tab!]`;

      // Log the agent action
      await agentActionsCol.insertOne({
        user_id: userId,
        agent_name: 'Chat Agent',
        trigger_type: 'tool_call',
        action_taken: 'Triggered plan adjustment',
        reasoning_summary: `Executed regenerate_plan tool with reason: ${adjustment_reason}`,
        created_at: new Date()
      });
    }

    return {
      message: assistantMessage.trim(),
      toolCalled: !!toolUseBlock
    };
  } catch (error) {
    console.error('Chat Agent error:', error);
    return {
      message: 'I am sorry, I encountered an issue updating your query. Please try again or check your database/API keys.',
      toolCalled: false
    };
  }
}

module.exports = {
  handleChat
};