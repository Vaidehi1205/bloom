const express = require('express');
const router = express.Router();
const { getDb } = require('../mongodb');
const authMiddleware = require('../middleware/auth');
const { moderatePost } = require('../agents/moderation');

// GET COMMUNITY POSTS WITH REPLIES AND POSTER EMAILS
router.get('/posts', authMiddleware, async (req, res) => {
  const locale = req.query.locale || 'en';

  try {
    const database = await getDb();
    const postsCol = database.collection('community_posts');
    const usersCol = database.collection('users');

    // Fetch posts
    const posts = await postsCol
      .find({ locale })
      .sort({ created_at: -1 })
      .toArray();

    // Fetch user emails for each post
    for (const post of posts) {
      if (post.user_id) {
        const user = await usersCol.findOne(
          { id: post.user_id },
          { projection: { email: 1 } }
        );
        post.user_email = user?.email || null;
      }

      // Fetch replies for each post
      const repliesCol = database.collection('community_replies');
      const replies = await repliesCol
        .find({ post_id: post._id?.toString?.() ?? post.id })
        .sort({ created_at: 1 })
        .toArray();

      // Fetch user emails for replies
      for (const reply of replies) {
        if (reply.user_id) {
          const replyUser = await usersCol.findOne(
            { id: reply.user_id },
            { projection: { email: 1 } }
          );
          reply.user_email = replyUser?.email || null;
        }
      }
      post.replies = replies;
    }

    res.json(posts);
  } catch (error) {
    console.error('Fetch posts error:', error);
    res.status(500).json({ error: 'Internal server error fetching community posts.' });
  }
});

// POST A NEW COMMUNITY POST
router.post('/posts', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { body, locale, anonymous } = req.body;

  if (!body || !locale) {
    return res.status(400).json({ error: 'Post content and language locale are required.' });
  }

  try {
    const postUserId = anonymous ? null : userId;
    const database = await getDb();
    const postsCol = database.collection('community_posts');

    const result = await postsCol.insertOne({
      user_id: postUserId,
      body,
      locale,
      moderation_status: 'pending',
      created_at: new Date()
    });

    const newPost = {
      id: result.insertedId.toString(),
      user_id: postUserId,
      body,
      locale,
      moderation_status: 'pending',
      created_at: new Date()
    };

    // Trigger Content Moderation Agent in the background (asynchronous)
    moderatePost(newPost.id, body, userId).then((status) => {
      console.log(`Async moderation complete for post ID ${newPost.id}. Status: ${status}`);
    }).catch(err => {
      console.error(`Async moderation failed for post ID ${newPost.id}:`, err);
    });

    res.status(201).json({
      message: 'Post submitted and is undergoing safety screening.',
      post: newPost
    });
  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({ error: 'Internal server error creating post.' });
  }
});

// POST A REPLY TO A POST
router.post('/posts/:id/replies', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const postId = req.params.id;
  const { body } = req.body;

  if (!body) {
    return res.status(400).json({ error: 'Reply content is required.' });
  }

  try {
    const database = await getDb();
    const postsCol = database.collection('community_posts');
    const repliesCol = database.collection('community_replies');

    // Ensure the post exists
    const post = await postsCol.findOne({ _id: postId });
    if (!post) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    // Insert reply
    const result = await repliesCol.insertOne({
      post_id: postId,
      user_id: userId,
      body,
      created_at: new Date()
    });

    const reply = {
      id: result.insertedId.toString(),
      post_id: postId,
      user_id: userId,
      body,
      created_at: new Date()
    };
    reply.user_email = req.user.email; // attach email for UI mapping

    res.status(201).json({
      message: 'Reply added successfully.',
      reply
    });
  } catch (error) {
    console.error('Create reply error:', error);
    res.status(500).json({ error: 'Internal server error replying to post.' });
  }
});

module.exports = router;