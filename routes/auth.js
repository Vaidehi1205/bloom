const express = require('express');
const https = require('https');
const router = express.Router();
const { initialized: firebaseInitialized } = require('../firebase');

require('dotenv').config();

function callFirebaseAuth(endpoint, payload) {
  const apiKey = process.env.FIREBASE_API_KEY;
  if (!apiKey) {
    return Promise.reject(new Error('Firebase authentication is not configured.'));
  }

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ ...payload, returnSecureToken: true });
    const req = https.request({
      hostname: 'identitytoolkit.googleapis.com',
      path: `/v1/accounts:${endpoint}?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          if (res.statusCode >= 400) {
            const message = parsed.error?.message || 'Firebase authentication failed.';
            const normalized = String(message).toUpperCase();
            const friendlyMessage = normalized.includes('INVALID') || normalized.includes('EMAIL_NOT_FOUND') || normalized.includes('MISSING_PASSWORD') || normalized.includes('USER_DISABLED') || normalized.includes('TOO_MANY_ATTEMPTS')
              ? 'Invalid email or password.'
              : normalized === 'EMAIL_EXISTS'
                ? 'An account with this email already exists.'
                : normalized === 'WEAK_PASSWORD'
                  ? 'Password should be at least 6 characters.'
                  : message;
            reject(new Error(friendlyMessage));
            return;
          }
          resolve(parsed);
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}



// SIGNUP
router.post('/signup', async (req, res) => {
  const { email, password, locale } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    if (!firebaseInitialized) {
      return res.status(500).json({ error: 'Firebase Admin is not initialized. Check your Firebase credentials or GOOGLE_APPLICATION_CREDENTIALS.' });
    }

    if (!process.env.FIREBASE_API_KEY) {
      return res.status(500).json({ error: 'Firebase API key is not configured.' });
    }

    const authResult = await callFirebaseAuth('signUp', {
      email,
      password,
      returnSecureToken: true
    });

    const user = {
      id: authResult.localId,
      email: authResult.email,
      locale: locale || 'en'
    };

    return res.status(201).json({
      token: authResult.idToken,
      user
    });
  } catch (error) {
    console.error('Signup error:', error);
    const message = error.message || 'Internal server error during registration.';
    const statusCode = message === 'An account with this email already exists.' ? 409 : 500;
    res.status(statusCode).json({ error: message });
  }
});

// LOGIN
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    if (!firebaseInitialized) {
      return res.status(500).json({ error: 'Firebase Admin is not initialized. Check your Firebase credentials or GOOGLE_APPLICATION_CREDENTIALS.' });
    }

    if (!process.env.FIREBASE_API_KEY) {
      return res.status(500).json({ error: 'Firebase API key is not configured.' });
    }

    const authResult = await callFirebaseAuth('signInWithPassword', {
      email,
      password,
      returnSecureToken: true
    });

    const user = {
      id: authResult.localId,
      email: authResult.email,
      locale: req.body.locale || 'en'
    };

    return res.json({
      token: authResult.idToken,
      user
    });
  } catch (error) {
    console.error('Login error:', error);
    const message = error.message || 'Internal server error during login.';
    const statusCode = message === 'Invalid email or password.' ? 401 : 500;
    res.status(statusCode).json({ error: message });
  }
});

// LOGOUT (Stateless token removal is handled on client)
router.post('/logout', (req, res) => {
  res.json({ message: 'Successfully logged out.' });
});

module.exports = router;
