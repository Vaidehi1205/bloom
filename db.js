const { getFirestore, admin } = require('./firebase');

/**
 * Firestore-backed minimal SQL-like adapter.
 *
 * The codebase currently calls db.query() with strings such as:
 *   SELECT * FROM predictions WHERE user_id = $1 ORDER BY id DESC LIMIT 1
 *   UPDATE users SET locale = $1 WHERE id = $2
 *   INSERT INTO daily_logs (...columns...) VALUES ($1,$2,...)
 *
 * This module implements just enough to support those query patterns.
 */

const firestore = (() => {
  try {
    return getFirestore();
  } catch (e) {
    return null;
  }
})();

function ensureFirestore() {
  if (!firestore) {
    throw new Error('Firestore is not available. Check Firebase Admin initialization credentials.');
  }
  return firestore;
}

function parseJSONMaybe(val) {
  if (val == null) return null;
  if (typeof val !== 'string') return val;
  try {
    return JSON.parse(val);
  } catch {
    return val;
  }
}

function normalizeOrderBy(sql) {
  const lower = sql.toLowerCase();
  // Very small heuristic for app's usage.
  if (lower.includes('order by id desc')) return { field: 'id', dir: 'desc' };
  if (lower.includes('order by scheduled_for desc')) return { field: 'scheduled_for', dir: 'desc' };
  if (lower.includes('order by created_at desc')) return { field: 'created_at', dir: 'desc' };
  if (lower.includes('order by date desc')) return { field: 'date', dir: 'desc' };
  return null;
}

function extractTable(sql) {
  // SELECT * FROM <table>
  const m = sql.match(/from\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
  return m?.[1];
}

function extractLimit(sql) {
  const m = sql.match(/limit\s+(\d+)/i);
  return m ? Number(m[1]) : null;
}

function extractWhereUserId(sql) {
  // WHERE user_id = $1
  if (!/where\s+user_id\s*=\s*\$1/i.test(sql)) return null;
  return 0; // $1 index in params array
}

function extractWhereIdEqParam(sql) {
  // WHERE id = $2 (or other)
  const m = sql.match(/where\s+id\s*=\s*\$(\d+)/i);
  if (!m) return null;
  return Number(m[1]) - 1;
}

function extractWhereUserIdAndId(sql) {
  // WHERE id = $1 AND user_id = $2
  const m = sql.match(/where\s+id\s*=\s*\$(\d+)\s+and\s+user_id\s*=\s*\$(\d+)/i);
  if (!m) return null;
  return { idParamIdx: Number(m[1]) - 1, userIdParamIdx: Number(m[2]) - 1 };
}

function extractDeleteTableWhere(sql) {
  const m = sql.match(/delete\s+from\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
  if (!m) return null;
  const table = m[1];
  return table;
}

async function selectRows({ table, userId, limit, orderBy }) {
  const db = ensureFirestore();
  const col = db.collection(table);

  let query = col.where('user_id', '==', userId);
  // App uses different “order by” fields.
  if (orderBy?.field) {
    query = query.orderBy(orderBy.field, orderBy.dir);
  }
  if (limit != null) {
    query = query.limit(limit);
  }

  const snap = await query.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function deleteRows({ table, id, userId }) {
  const db = ensureFirestore();
  const col = db.collection(table);
  // Using compound constraints would require indexing; easiest is query then delete.
  let q = col.where('id', '==', id);
  if (userId != null) q = q.where('user_id', '==', userId);
  const snap = await q.get();

  const deletes = snap.docs.map((doc) => doc.ref.delete());
  await Promise.all(deletes);
  return { affectedRows: snap.size };
}

async function updateRowsUsersLocale({ locale, userId }) {
  const db = ensureFirestore();
  const col = db.collection('users');
  // App uses UPDATE users SET locale = $1 WHERE id = $2
  // We store users as docs in /users with field id (or use doc id).

  // Prefer deterministic doc lookup if possible.
  const maybeDoc = await col.doc(String(userId)).get().catch(() => null);
  if (maybeDoc?.exists) {
    await col.doc(String(userId)).set({ locale }, { merge: true });
    return;
  }

  // Fallback: query by id field.
  const snap = await col.where('id', '==', userId).get();
  const updates = snap.docs.map((d) => d.ref.set({ locale }, { merge: true }));
  await Promise.all(updates);
}

async function insertDailyLog(params) {
  const db = ensureFirestore();
  const col = db.collection('daily_logs');

  const [userId, date, waterIntakeMl, completed, sleepHours, mood, symptomsStr] = params;

  // Create auto doc id
  const docRef = col.doc();
  await docRef.set({
    user_id: userId,
    date,
    water_intake_ml: waterIntakeMl,
    exercise_completed: completed,
    sleep_hours: sleepHours,
    mood,
    symptoms: symptomsStr
  });
}

async function upsertDailyLog(params) {
  const db = ensureFirestore();
  const [userId, date, waterIntakeMl, completed, sleepHours, mood, symptomsStr] = params;

  const col = db.collection('daily_logs');
  const snap = await col.where('user_id', '==', userId).where('date', '==', date).limit(1).get();

  if (snap.empty) {
    await insertDailyLog(params);
    return { inserted: true };
  }

  const doc = snap.docs[0];
  await doc.ref.set({
    water_intake_ml: waterIntakeMl,
    exercise_completed: completed,
    sleep_hours: sleepHours,
    mood,
    symptoms: symptomsStr
  }, { merge: true });

  return { inserted: false };
}

async function query(sql, params = []) {
  const sqlTrim = String(sql).trim();
  const lower = sqlTrim.toLowerCase();

  // SELECT ... FROM <table> WHERE user_id = $1 ... LIMIT N
  if (/^select\s+/i.test(sqlTrim)) {
    const table = extractTable(sqlTrim);
    if (!table) return { rows: [] };

    const whereUserIdParamIdx = extractWhereUserId(sqlTrim);
    const orderBy = normalizeOrderBy(sqlTrim);
    const limit = extractLimit(sqlTrim);

    if (whereUserIdParamIdx != null) {
      const userId = params[whereUserIdParamIdx];
      const rows = await selectRows({ table, userId, limit, orderBy });
      return { rows };
    }

    // Locale query: SELECT locale FROM users WHERE id = $1
    const whereIdParamIdx = extractWhereIdEqParam(sqlTrim);
    if (whereIdParamIdx != null && table === 'users') {
      const idVal = params[whereIdParamIdx];
      const db = ensureFirestore();
      const snap = await db.collection('users').where('id', '==', idVal).limit(1).get();
      const rows = snap.docs.map((d) => d.data()).map((d) => ({ locale: d.locale })) ;
      return { rows };
    }

    // Default fallback
    throw new Error(`Unsupported SELECT SQL (Firestore adapter). SQL=${sqlTrim}`);
  }

  // INSERT INTO daily_logs ...
  if (/^insert\s+/i.test(sqlTrim)) {
    if (/into\s+daily_logs/i.test(sqlTrim)) {
      await upsertDailyLog(params);
      return { rows: [] };
    }

    throw new Error(`Unsupported INSERT SQL (Firestore adapter). SQL=${sqlTrim}`);
  }

  // UPDATE users SET locale = ... WHERE id = ...
  if (/^update\s+/i.test(sqlTrim)) {
    if (/users/i.test(sqlTrim) && /set\s+locale/i.test(sqlTrim) && /where\s+id/i.test(sqlTrim)) {
      const locale = params[0];
      const userId = params[1];
      await updateRowsUsersLocale({ locale, userId });
      return { rows: [] };
    }

    if (/update\s+daily_logs/i.test(sqlTrim)) {
      // Used in daily-logs update path. Params order in route:
      // [water_intake_ml, completed, sleep_hours, mood, symptomsStr, userId, date]
      // But our upsert expects: [userId, date, waterIntakeMl, completed, sleepHours, mood, symptomsStr]
      const [waterIntakeMl, completed, sleepHours, mood, symptomsStr, userId, date] = params;
      await upsertDailyLog([userId, date, waterIntakeMl, completed, sleepHours, mood, symptomsStr]);
      return { rows: [] };
    }

    throw new Error(`Unsupported UPDATE SQL (Firestore adapter). SQL=${sqlTrim}`);
  }

  // DELETE FROM notifications WHERE id = $1 AND user_id = $2
  if (/^delete\s+/i.test(sqlTrim)) {
    const table = extractDeleteTableWhere(sqlTrim);
    if (!table) return { rows: [] };

    const whereBoth = extractWhereUserIdAndId(sqlTrim);
    if (whereBoth && table === 'notifications') {
      const id = params[whereBoth.idParamIdx];
      const userId = params[whereBoth.userIdParamIdx];
      await deleteRows({ table, id, userId });
      return { rows: [] };
    }

    return { rows: [] };
  }

  return { rows: [] };
}

module.exports = {
  dbType: 'firestore',
  initDb: async () => true,
  query
};

