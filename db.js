const { getDb } = require('./mongodb');

/**
 * MongoDB-backed minimal SQL-like adapter.
 *
 * The codebase currently calls db.query() with SQL-like strings (a subset) and
 * positional parameters ($1, $2, ...). This adapter translates only the
 * query patterns used by Bloom routes into real MongoDB queries.
 */


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
  const database = await getDb();
  const col = database.collection(table);

  const filter = { user_id: userId };
  const sort = {};
  if (orderBy?.field) {
    sort[orderBy.field] = orderBy.dir === 'desc' ? -1 : 1;
  }

  let cursor = col.find(filter);
  if (Object.keys(sort).length) cursor = cursor.sort(sort);
  if (limit != null) cursor = cursor.limit(limit);

  const docs = await cursor.toArray();
  return docs.map((d) => ({ id: d._id?.toString?.() ?? d._id, ...d }));
}


async function deleteRows({ table, id, userId }) {
  const database = await getDb();
  const col = database.collection(table);

  const filter = { id };
  if (userId != null) filter.user_id = userId;

  const res = await col.deleteMany(filter);
  return { affectedRows: res.deletedCount ?? 0 };
}


async function updateRowsUsersLocale({ locale, userId }) {
  const database = await getDb();
  const col = database.collection('users');

  // Update by numeric/string id field.
  const res = await col.updateMany({ id: userId }, { $set: { locale } });
  if ((res.modifiedCount ?? 0) > 0) return;

  // Fallback: also try if caller stores users by _id.
  await col.updateMany({ _id: String(userId) }, { $set: { locale } }).catch(() => null);
}


async function insertDailyLog(params) {
  const database = await getDb();
  const col = database.collection('daily_logs');

  const [userId, date, waterIntakeMl, completed, sleepHours, mood, symptomsStr] = params;

  await col.insertOne({
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
  const database = await getDb();
  const col = database.collection('daily_logs');
  const [userId, date, waterIntakeMl, completed, sleepHours, mood, symptomsStr] = params;

  const filter = { user_id: userId, date };
  const update = {
    $set: {
      water_intake_ml: waterIntakeMl,
      exercise_completed: completed,
      sleep_hours: sleepHours,
      mood,
      symptoms: symptomsStr
    }
  };

  const res = await col.updateOne(filter, update, { upsert: true });
  const inserted = (res.upsertedCount ?? 0) > 0;
  return { inserted };
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

    // SELECT id FROM users (used by predictor warmup)
    if (table === 'users') {
      // Only handle the exact minimal projection we need.
      if (/select\s+id\s+from\s+users\b/i.test(sqlTrim)) {
        const database = await getDb();
        const users = database.collection('users');
        const docs = await users.find({}, { projection: { id: 1 } }).toArray();
        return {
          rows: docs.map((d) => ({ id: d.id ?? d._id?.toString?.() ?? d._id }))
        };
      }

      // Locale query: SELECT locale FROM users WHERE id = $1
      const whereIdParamIdx = extractWhereIdEqParam(sqlTrim);
      if (whereIdParamIdx != null && table === 'users') {
        const idVal = params[whereIdParamIdx];
        const database = await getDb();
        const users = database.collection('users');
        const doc = await users.findOne({ id: idVal }, { projection: { locale: 1 } });
        return { rows: doc ? [{ locale: doc.locale }] : [] };
      }
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
  dbType: 'mongodb',
  initDb: async () => true,
  query,
};





