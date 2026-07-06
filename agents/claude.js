require('dotenv').config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.CLAUDE_API_KEY;

// Shared Mock AI Logic
function generateMockResponse(systemPrompt, messages, tools) {
  const lastMessage = messages[messages.length - 1].content.toLowerCase();

  // 1. Check if the Chat Agent wants to call the Planner Agent tool
  if (systemPrompt.includes('Chat Agent') && tools && tools.length > 0) {
    if (lastMessage.includes('adjust') || lastMessage.includes('tired') || lastMessage.includes('exhausted') || lastMessage.includes('change plan') || lastMessage.includes('regenerate')) {
      // Return a tool call response
      return {
        content: [
          {
            type: 'text',
            text: 'I understand you are feeling tired or want to adjust your plan. I am going to trigger a replanning tool to adapt your diet and exercise program.'
          },
          {
            type: 'tool_use',
            id: 'tool_plan_1',
            name: 'regenerate_plan',
            input: {
              adjustment_reason: 'User reported feeling tired or requested adjustment.'
            }
          }
        ],
        stop_reason: 'tool_use'
      };
    }
  }

  // 2. Planner Agent output mock (Diet and Workout)
  if (systemPrompt.includes('Planner Agent') || systemPrompt.includes('diet') || systemPrompt.includes('exercise')) {
    let dietPref = 'None';
    if (lastMessage.includes('vegetarian')) dietPref = 'Vegetarian';
    if (lastMessage.includes('vegan')) dietPref = 'Vegan';
    if (lastMessage.includes('keto')) dietPref = 'Keto';

    const plan = {
      diet: {
        breakfast: dietPref === 'Vegetarian' || dietPref === 'Vegan' ? 'Oatmeal with chia seeds, banana slices, and almond milk' : 'Scrambled eggs with spinach, avocado, and whole wheat toast',
        lunch: dietPref === 'Vegan' ? 'Quinoa salad with chickpeas, cucumbers, cherry tomatoes, and tahini dressing' : 'Grilled chicken or tofu breast over mixed greens, quinoa, and olive oil vinaigrette',
        dinner: dietPref === 'Keto' ? 'Baked salmon with roasted asparagus and buttered cauliflower mash' : 'Lentil coconut curry with brown rice and steamed broccoli',
        snack: 'Mixed berries with raw almonds or walnuts',
        hydration: 'Target 2.5 Liters. Add ginger-lemon water if bloated.'
      },
      exercise: {
        workouts: [
          { day: 'Monday', routine: 'Gentle Pilates or yoga focus on core stability (30 mins)' },
          { day: 'Wednesday', routine: 'Steady-state cardio / brisk walking (35 mins)' },
          { day: 'Friday', routine: 'Full body bodyweight strength training (restorative, light weights)' }
        ],
        notes: lastMessage.includes('tired') || lastMessage.includes('exhausted')
          ? 'Workout plan was reduced in intensity because you are feeling fatigued. Focus on stretching and listening to your body.'
          : 'Standard wellness schedule adapted for your current cycle phase.'
      },
      disclaimer: 'This plan represents general health suggestions and does not constitute professional medical advice.'
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(plan, null, 2)
        }
      ]
    };
  }

  // 3. Moderation Agent mock response
  if (systemPrompt.includes('Moderation') || systemPrompt.includes('moderator')) {
    const isUnsafe = lastMessage.includes('suicide') || 
                      lastMessage.includes('kill myself') || 
                      lastMessage.includes('harass') || 
                      lastMessage.includes('fake news') || 
                      lastMessage.includes('cure cancer with juice') ||
                      lastMessage.includes('hate you') ||
                      lastMessage.includes('idiot');
    return {
      content: [
        {
          type: 'text',
          text: isUnsafe ? 'flagged' : 'approved'
        }
      ]
    };
  }

  // 4. Default Chat Agent or general helper QA response
  let answer = 'Thank you for reaching out. Bloom Gemini is here to support your wellness journey. How can I help you today?';
  
  if (lastMessage.includes('cramp') || lastMessage.includes('pain')) {
    answer = 'For period cramps, applying a warm heating pad to your lower abdomen and drinking hot ginger or chamomile tea can provide relief. Gentle stretching or a warm bath is also helpful. If the pain is severe or persistent, please consult a healthcare professional.';
  } else if (lastMessage.includes('phase') || lastMessage.includes('cycle')) {
    answer = 'A menstrual cycle has four key phases: Menstrual (days 1-5, shedding phase), Follicular (days 6-13, rising energy), Ovulatory (around day 14, peak fertility), and Luteal (days 15-28, winding down). Tracking helps you align your nutrition and exercises with these shifts!';
  } else if (lastMessage.includes('hello') || lastMessage.includes('hi')) {
    answer = 'Hello! I am your Bloom Gemini Assistant. I can help answer general questions about menstrual wellness, explain your cycle phases, or adapt your weekly diet and workout plan. What is on your mind?';
  } else if (lastMessage.includes('sleep')) {
    answer = 'Prioritizing sleep is crucial during your luteal and menstrual phases when hormones shift. Try keeping a consistent bedtime, avoiding screens 1 hour before sleep, and drinking chamomile tea to help wind down.';
  }

  return {
    content: [
      {
        type: 'text',
        text: answer
      }
    ]
  };
}

// Global invocation function
async function callClaude({ systemPrompt, messages, tools = [] }) {
  const hasValidApiKey = typeof GEMINI_API_KEY === 'string' && GEMINI_API_KEY.trim() && !GEMINI_API_KEY.includes('your_') && !GEMINI_API_KEY.includes('placeholder');

  if (!hasValidApiKey) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    return generateMockResponse(systemPrompt, messages, tools);
  }

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: `${systemPrompt}\n\n${messages.map((m) => `${m.role}: ${m.content}`).join('\n')}` }]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 4000
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API request failed with status ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';

    return {
      content: [{ type: 'text', text }]
    };
  } catch (error) {
    console.error('Error invoking Claude API, falling back to mock:', error.message);
    return generateMockResponse(systemPrompt, messages, tools);
  }
}

module.exports = {
  callClaude
};
