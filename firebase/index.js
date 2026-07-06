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

const getAuth = () => {
  if (!initialized) {
    const hint = process.env.GOOGLE_APPLICATION_CREDENTIALS
      ? `GOOGLE_APPLICATION_CREDENTIALS is set to "${process.env.GOOGLE_APPLICATION_CREDENTIALS}" but Firebase still failed to initialize. Check the path and JSON validity.`
      : 'Set FIREBASE_SERVICE_ACCOUNT (JSON string or file path) or GOOGLE_APPLICATION_CREDENTIALS (path to service account JSON).';
    const err = initializationError || new Error('Firebase Admin is not initialized.');
    // Throw a clearer error only when Auth is actually requested.
    err.message = `${err.message}\n${hint}`;
    throw err;
  }
  return admin.auth();
};

module.exports = {
  get initialized() {
    return initialized;
  },
  get initializationError() {
    return initializationError;
  },
  getAuth,
  admin
};



