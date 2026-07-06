const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { handleChat } = require('../agents/chat');

// CHAT WITH BOT
router.post('/', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { message, history } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required.' });
  }

  try {
    // Format message history
    const messageHistory = history || [];
    messageHistory.push({ role: 'user', content: message });

    // Call Chat Agent orchestrator
    const result = await handleChat(userId, messageHistory);

    res.json({
      reply: result.message,
      toolCalled: result.toolCalled
    });
  } catch (error) {
    console.error('Chat routing error:', error);
    res.status(500).json({ error: 'Internal server error processing chat.' });
  }
});

module.exports = router;
