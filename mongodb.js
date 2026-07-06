const { MongoClient } = require('mongodb');
require('dotenv').config();

let client;
let db;
let connectPromise;

function getMongoUri() {
  // Support a couple common env var names to avoid silent misconfiguration.
  const uri =
    process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    process.env.MONGODB_URL ||
    process.env.MONGO_DB_URI;

  if (!uri) {
    const envPresent = {
      MONGODB_URI: Boolean(process.env.MONGODB_URI),
      MONGO_URI: Boolean(process.env.MONGO_URI),
      MONGODB_DB_NAME: Boolean(process.env.MONGODB_DB_NAME),
      MONGODB_TLS: Boolean(process.env.MONGODB_TLS),
      MONGODB_TLS_ALLOW_UNAUTHORIZED: Boolean(process.env.MONGODB_TLS_ALLOW_UNAUTHORIZED),
      MONGODB_URL: Boolean(process.env.MONGODB_URL),
      MONGO_DB_URI: Boolean(process.env.MONGO_DB_URI),
    };

    throw new Error(
      `Missing MongoDB connection string in environment. Expected one of: MONGODB_URI, MONGO_URI, MONGODB_URL, or MONGO_DB_URI. ` +
        `Env presence: ${JSON.stringify(envPresent)}.`
    );
  }
  return uri;
}


function getDbName() {
  return process.env.MONGODB_DB_NAME || 'bloom';
}

function uriWantsTLS(uri) {
  // If connection string explicitly includes tls/ssl, let it decide.
  // Example: mongodb+srv://.../?tls=true
  return /[?&](tls|ssl)=true/i.test(uri) || /[?&]tlsAllowInvalidCertificates=true/i.test(uri);
}

function buildClientOptions(uri) {
  // Don’t force TLS unless the user says so.
  // For Atlas/SRV, TLS is typically required but often already set by the URI.
  const allowInvalid = process.env.MONGODB_TLS_ALLOW_UNAUTHORIZED === 'true';
  const tlsEnv = process.env.MONGODB_TLS; // 'true'/'false'

  let tls;
  if (uriWantsTLS(uri)) {
    tls = true;
  } else if (tlsEnv === 'true') {
    tls = true;
  } else if (tlsEnv === 'false') {
    tls = false;
  } else {
    // Atlas/SRV endpoints require TLS.
    tls = /mongodb\+srv:/i.test(uri) ? true : undefined;
  }

  // Atlas certificates negotiation sometimes fails with older TLS behavior.
  // If the connection string doesn't already enforce a TLS mode, allow a modern SSL handshake.
  // (No tlsMinVersion option here because some driver versions/runtime reject it.)


  const options = {
    serverSelectionTimeoutMS: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 15000),
  };

  if (tls !== undefined) options.tls = tls;

  // Only apply invalid certificate override when explicitly enabled.
  if (allowInvalid) {
    options.tlsAllowInvalidCertificates = true;
  }

  // IMPORTANT: Do not set tlsMinVersion (or any other TLS version constraints).
  // The installed mongodb driver/runtime may reject it with:
  // "option tlsminversion is not supported".
  return options;
}

async function connectMongo({ retries = 3, retryDelayMs = 5000 } = {}) {
  if (db) return db;
  if (connectPromise) return connectPromise;

  const uri = getMongoUri();
  const dbName = getDbName();

  connectPromise = (async () => {
    console.log('[Mongo] Starting connection attempt...');

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`[Mongo] Connecting (attempt ${attempt}/${retries})...`);
        const clientOptions = buildClientOptions(uri);

        // Create a new client per attempt to avoid stale topology on failures.
        client = new MongoClient(uri, clientOptions);
        await client.connect();
        db = client.db(dbName);

        console.log(`[Mongo] Connected successfully. DB='${dbName}'.`);
        return db;
      } catch (e) {
        const msg = e?.message || String(e);
        console.error(`[Mongo] Connection attempt ${attempt}/${retries} failed:`, msg);

        // If this was the last attempt, rethrow.
        if (attempt === retries) throw e;

        // Backoff before retrying.
        await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
      }
    }

    return db;
  })();

  return connectPromise;
}

function getDb() {
  if (!db) {
    const hasMongoUri = Boolean(process.env.MONGODB_URI || process.env.MONGO_URI);
    const hint = hasMongoUri
      ? `Mongo URI is set, but connection not established. Check Mongo logs above and TLS env vars (MONGODB_TLS, MONGODB_TLS_ALLOW_UNAUTHORIZED).`
      : 'Set MONGODB_URI (or MONGO_URI) in .env (MongoDB connection string).';

    const tlsDebug = {
      MONGODB_TLS: process.env.MONGODB_TLS || null,
      MONGODB_TLS_ALLOW_UNAUTHORIZED: process.env.MONGODB_TLS_ALLOW_UNAUTHORIZED || null,
      MONGODB_SERVER_SELECTION_TIMEOUT_MS:
        process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || null,
    };

    throw new Error(`MongoDB is not connected. ${hint} TLS env debug: ${JSON.stringify(tlsDebug)}`);
  }
  return db;
}


async function initMongo() {
  // initMongo is allowed to fail without crashing the server.
  try {
    const uri = getMongoUri();
    console.log('[Mongo] Using URI (redacted). Has tls=true in URI?:', uriWantsTLS(uri));

    await connectMongo({
      retries: Number(process.env.MONGODB_CONNECT_RETRIES || 3),
      retryDelayMs: Number(process.env.MONGODB_CONNECT_RETRY_DELAY_MS || 5000),
    });
    return db;
  } catch (e) {
    console.error(
      'MongoDB init failed (server will continue without Mongo):',
      e?.message || e
    );
    return null;
  }
}


module.exports = {
  initMongo,
  getDb,
};



