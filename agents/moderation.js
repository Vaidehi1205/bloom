const db = require('../db');
const { callClaude } = require('./claude');

/**
 * Screens a community post for safety guidelines.
 * @param {number} postId
 * @param {string} postBody
 * @param {number|null} userId
 */
async function moderatePost(postId, postBody, userId) {
  try {
    const systemPrompt = `You are the Bloom Content Moderation Agent. 
Your sole task is to analyze the text of a user post on our women's health community platform.
You must flag content that contains:
1. Harassment, hate speech, or abuse targeting others.
2. Medical misinformation (e.g. promoting dangerous cures, anti-science medical claims, claiming fake treatments).
3. Self-harm, suicide, or self-injury mentions/intentions.

You must only output either the exact word: "approved" or "flagged".
Do not write anything else. No chat, no markdown.`;

    const result = await callClaude({
      systemPrompt,
      messages: [{ role: 'user', content: postBody }]
    });

    const decision = result.content[0].text.trim().toLowerCase();
    const isApproved = decision.includes('approved') && !decision.includes('flagged');
    const moderationStatus = isApproved ? 'approved' : 'flagged';

    // Update community post in database
    await db.query(
      'UPDATE community_posts SET moderation_status = $1 WHERE id = $2',
      [moderationStatus, postId]
    );

    // Audit log
    const summary = `Post ID ${postId} evaluated as "${moderationStatus}". Reason: ${isApproved ? 'Passed compliance check' : 'Triggered safety guidelines'}`;
    await db.query(
      'INSERT INTO agent_actions (user_id, agent_name, trigger_type, action_taken, reasoning_summary) VALUES ($1, $2, $3, $4, $5)',
      [userId, 'Moderation Agent', 'new_community_post', `Set status to ${moderationStatus}`, summary]
    );

    return moderationStatus;
  } catch (error) {
    console.error('Moderation Agent error:', error);
    // Safe default fallback in case of errors: approve but log the error
    await db.query(
      "UPDATE community_posts SET moderation_status = 'approved' WHERE id = $1",
      [postId]
    );
    return 'approved';
  }
}

module.exports = {
  moderatePost
};
