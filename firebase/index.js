const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

let initialized = false;
let initializationError = null;

function readServiceAccount(value) {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    if (trimmed.startsWith('{')) {
      return JSON.parse(trimmed);
    }

    const candidatePath = path.isAbsolute(trimmed) ? trimmed : path.join(process.cwd(), trimmed);
    if (fs.existsSync(candidatePath)) {
      return JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
    }
  } catch (error) {
    console.warn('FIREBASE_SERVICE_ACCOUNT is not a valid JSON object or file path. Falling back to Application Default Credentials.');
  }

  return null;
}

function initializeFirebaseAdmin() {
  // If firebase-admin provides getApps(), use it to avoid double initialization.
  if (typeof admin.getApps === 'function') {
    const apps = admin.getApps();
    if (Array.isArray(apps) && apps.length) {
      initialized = true;
      return;
    }
  }



  const serviceAccount = readServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const projectId = process.env.FIREBASE_PROJECT_ID;

  try {
    const getCredentialFromJson = (json) => {
      // Prefer newer api: admin.credential.cert(json)
      if (admin.credential && typeof admin.credential.cert === 'function') {
        return admin.credential.cert(json);
      }
      // Fallback: older api: admin.cert(json)
      if (typeof admin.cert === 'function') {
        return admin.cert(json);
      }
      throw new Error('firebase-admin does not expose a usable cert() credential factory.');
    };

    if (serviceAccount) {
      admin.initializeApp({
        credential: getCredentialFromJson(serviceAccount),
        projectId: projectId || serviceAccount.project_id
      });
      initialized = true;
      console.log('Firebase Admin initialized with service account credentials.');
      return;
    }

    if (credentialsPath && fs.existsSync(credentialsPath)) {
      const credentialsFile = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
      admin.initializeApp({
        credential: getCredentialFromJson(credentialsFile),
        projectId: projectId || credentialsFile.project_id
      });
      initialized = true;
      console.log('Firebase Admin initialized from GOOGLE_APPLICATION_CREDENTIALS.');
      return;
    }


    const appOptions = {};
    if (projectId) {
      appOptions.projectId = projectId;
    }
    // Use application default credentials when supported.
    // firebase-admin versions vary:
    // - some expose admin.applicationDefault()
    // - some expose admin.credential.applicationDefault()
    let credential;

    if (typeof admin.applicationDefault === 'function') {
      credential = admin.applicationDefault();
    } else if (admin.credential && typeof admin.credential.applicationDefault === 'function') {
      credential = admin.credential.applicationDefault();
    }

    if (!credential) {
      // Non-fatal: credentials are not configured for this environment.
      initializationError = new Error(
        'firebase-admin could not initialize credentials. Provide FIREBASE_SERVICE_ACCOUNT (JSON or file path) or GOOGLE_APPLICATION_CREDENTIALS (path to JSON).'
      );
      console.warn('Firebase Admin not initialized (missing credentials / unsupported application default).');
      return;
    }

    admin.initializeApp({
      ...appOptions,
      credential
    });
    initialized = true;
    console.log('Firebase Admin initialized with application default credentials.');
  } catch (error) {
    initializationError = error;
    console.error('Firebase Admin initialization failed:', error);
  }
}

initializeFirebaseAdmin();

async function verifyFirestoreConnectivity({ timeoutMs = 5000 } = {}) {
  if (!initialized) {
    return { ok: false, reason: 'Firebase Admin not initialized', error: initializationError };
  }

// Only attempt verification if Firestore access is possible.
  try {
    // Force creation of Firestore client via the same logic used at runtime.
    const firestore = (typeof admin.firestore === 'function')
      ? admin.firestore()
      : (typeof admin.app === 'function' && admin.app()?.firestore ? admin.app().firestore() : getFirestore());

    const projectId = process.env.FIREBASE_PROJECT_ID || admin?.options?.projectId;

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Firestore connectivity check timed out after ${timeoutMs}ms`)), timeoutMs);
    });


    // Read current timestamp from server (cheap) by doing a no-op write in a transaction? Firestore doesn't offer true no-op.
    // Instead: list one collection is not supported without knowing its name.
    // Best-effort: fetch the admin SDK's Firestore settings.
    // We'll do a single call that forces gRPC to reach Firestore: admin.firestore() is already created,
    // so we perform a small read on a deterministic, non-existent document with get() and handle NotFound.
    // Firestore collection IDs cannot start with "__" (reserved internal namespace).
    const docRef = firestore.collection('bloom_healthcheck').doc('connectivity');
    const readPromise = docRef.get().then((snap) => {
      // If doc doesn't exist, Firestore is still reachable.
      return { ok: true, exists: snap.exists, projectId };
    });

    const result = await Promise.race([readPromise, timeoutPromise]);
    return result;
  } catch (error) {
    return {
      ok: false,
      reason: 'Firestore connectivity failed',
      projectId: process.env.FIREBASE_PROJECT_ID,
      error
    };
  }
}

// Optionally run a startup verification only when Firebase Admin is initialized.
// This avoids noisy startup failures when credentials are intentionally not configured.
// Enable with FIREBASE_VERIFY_CONNECTIVITY=true
if (initialized && process.env.FIREBASE_VERIFY_CONNECTIVITY === 'true') {
  verifyFirestoreConnectivity()
    .then((r) => {
      if (!r.ok) {
        console.error('Firestore startup connectivity check failed:', {
          reason: r.reason,
          projectId: r.projectId || process.env.FIREBASE_PROJECT_ID,
          message: r.error?.message,
          code: r.error?.code
        });
      } else {
        console.log('Firestore startup connectivity check OK:', {
          exists: r.exists,
          projectId: r.projectId || process.env.FIREBASE_PROJECT_ID
        });
      }
    })
    .catch((e) => {
      console.error('Firestore startup connectivity check unexpected error:', e);
    });
} else if (process.env.FIREBASE_VERIFY_CONNECTIVITY === 'true' && initializationError) {
  // Only warn when explicitly enabled.
  console.warn('Firebase Admin not initialized; skipping Firestore connectivity check.');
}



const getAuth = () => {
  if (!initialized) {
    throw initializationError || new Error('Firebase Admin is not initialized.');
  }
  return admin.auth();
};


const getFirestore = () => {
  if (!initialized) {
    throw initializationError || new Error('Firebase Admin is not initialized.');
  }

  // firebase-admin differs by version/build. Prefer the official accessors that exist.
  // 1) admin.firestore() (newer shapes)
  if (typeof admin.firestore === 'function') {
    return admin.firestore();
  }

  // 2) admin.app().firestore() (common)
  if (typeof admin.app === 'function') {
    const app = admin.app();
    if (app && typeof app.firestore === 'function') {
      return app.firestore();
    }
  }

  // 3) admin.getApps()[0].firestore() (explicit)
  const appsArr = Array.isArray(admin.getApps()) ? admin.getApps() : [];
  if (appsArr.length && appsArr[0] && typeof appsArr[0].firestore === 'function') {
    return appsArr[0].firestore();
  }

  const appsCount = Array.isArray(admin.getApps()) ? admin.getApps().length : 'unknown';
  throw new Error(
    `Firebase Admin does not expose Firestore helpers. Check firebase-admin version/install and credentials. Initialized=${initialized}, apps=${appsCount}`
  );
};

module.exports = {
  get initialized() {
    return initialized;
  },
  get initializationError() {
    return initializationError;
  },
  getAuth,
  getFirestore,
  admin
};
