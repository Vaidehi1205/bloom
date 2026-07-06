const { getAuth, initialized: firebaseInitialized } = require('../firebase');
require('dotenv').config();


async function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  // Accept either: "Bearer <token>" or just "<token>" (some clients may omit the scheme)
  const parts = authHeader.split(' ').map(s => s.trim()).filter(Boolean);
  const token = parts.length === 1 ? parts[0] : parts[1];
  if (typeof token === 'string' && !token.trim()) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }
  if (!token) {
    return res.status(401).json({ error: 'Access denied. Invalid token format.' });
  }

  try {
    if (!firebaseInitialized) {
      return res.status(500).json({ error: 'Firebase Admin is not initialized. Check your Firebase credentials or GOOGLE_APPLICATION_CREDENTIALS.' });
    }

    const firebaseAuth = getAuth();
    const decoded = await firebaseAuth.verifyIdToken(token);

    req.user = {
      id: decoded.uid,
      firebaseUid: decoded.uid,
      email: decoded.email || decoded.uid,
      locale: decoded.locale || 'en'
    };
    return next();
  } catch (error) {
    console.error('Firebase auth middleware error:', error);
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

module.exports = authMiddleware;
