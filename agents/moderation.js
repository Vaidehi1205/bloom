const { getDb } = require('../mongodb');
const { callClaude } = require('./claude');

/**
 * Screens a community post for safety guidelines.
 * @param {string} postId
 * @param {string} postBody
 * @param {string|null} userId
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
    const database = await getDb();
    const postsCol = database.collection('community_posts');
    const agentActionsCol = database.collection('agent_actions');

    await postsCol.updateOne(
      { _id: postId },
      { $set: { moderation_status: moderationStatus } }
    );

    // Audit log
    const summary = `Post ID ${postId} evaluated as "${moderationStatus}". Reason: ${isApproved ? 'Passed compliance check' : 'Triggered safety guidelines'}`;
    await agentActionsCol.insertOne({
      user_id: userId,
      agent_name: 'Moderation Agent',
      trigger_type: 'new_community_post',
      action_taken: `Set status to ${moderationStatus}`,
      reasoning_summary: summary,
      created_at: new Date()
    });

    return moderationStatus;
  } catch (error) {
    console.error('Moderation Agent error:', error);
    // Safe default fallback in case of errors: approve but log the error
    const database = await getDb();
    const postsCol = database.collection('community_posts');
    await postsCol.updateOne(
      { _id: postId },
      { $set: { moderation_status: 'approved' } }
    );
    return 'approved';
  }
}

module.exports = {
  moderatePost
};