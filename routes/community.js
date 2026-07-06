const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const { moderatePost } = require('../agents/moderation');

// GET COMMUNITY POSTS WITH REPLIES AND POSTER EMAILS
router.get('/posts', authMiddleware, async (req, res) => {
  const locale = req.query.locale || 'en';

  try {
    // Fetch posts
    const postsRes = await db.query(
      `SELECT p.*, u.email as user_email 
       FROM community_posts p 
       LEFT JOIN users u ON p.user_id = u.id 
       WHERE p.locale = $1
       ORDER BY p.created_at DESC`,
      [locale]
    );

    const posts = postsRes.rows;

    // Fetch replies for each post
    for (const post of posts) {
      const repliesRes = await db.query(
        `SELECT r.*, u.email as user_email 
         FROM community_replies r 
         LEFT JOIN users u ON r.user_id = u.id 
         WHERE r.post_id = $1 
         ORDER BY r.created_at ASC`,
        [post.id]
      );
      post.replies = repliesRes.rows;
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
    
    // Insert post as 'pending'
    const insertRes = await db.query(
      'INSERT INTO community_posts (user_id, body, locale, moderation_status) VALUES ($1, $2, $3, $4) RETURNING id, user_id, body, locale, moderation_status, created_at',
      [postUserId, body, locale, 'pending']
    ).catch(async () => {
      // Fallback SQLite
      await db.query(
        'INSERT INTO community_posts (user_id, body, locale, moderation_status) VALUES ($1, $2, $3, $4)',
        [postUserId, body, locale, 'pending']
      );
      return db.query(
        'SELECT * FROM community_posts WHERE user_id = $1 AND body = $2 ORDER BY id DESC LIMIT 1',
        [postUserId, body]
      );
    });

    const newPost = insertRes.rows[0];

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
    // Ensure the post exists
    const checkPost = await db.query('SELECT id FROM community_posts WHERE id = $1', [postId]);
    if (checkPost.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    // Insert reply
    const insertRes = await db.query(
      'INSERT INTO community_replies (post_id, user_id, body) VALUES ($1, $2, $3) RETURNING *',
      [postId, userId, body]
    ).catch(async () => {
      // Fallback SQLite
      await db.query(
        'INSERT INTO community_replies (post_id, user_id, body) VALUES ($1, $2, $3)',
        [postId, userId, body]
      );
      return db.query(
        'SELECT * FROM community_replies WHERE post_id = $1 AND user_id = $2 ORDER BY id DESC LIMIT 1',
        [postId, userId]
      );
    });

    const reply = insertRes.rows[0];
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
