import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure .env is loaded from project root even if PM2 starts from home directory
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

function normalizePrivateKey(serviceAccount) {
  if (typeof serviceAccount.private_key === "string") {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
  }
  return serviceAccount;
}

function loadServiceAccountFromEnv() {
  const base64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64?.trim();
  if (!base64) {
    return null;
  }
  try {
    const json = Buffer.from(base64, "base64").toString("utf8");
    return normalizePrivateKey(JSON.parse(json));
  } catch (err) {
    console.error("❌ Failed to parse FIREBASE_SERVICE_ACCOUNT_BASE64:", err.message);
    return null;
  }
}

export function initFirebase() {
  if (admin.apps.length > 0) {
    return admin.app();
  }

  // Re-check env in case it was loaded late
  dotenv.config({ path: path.resolve(__dirname, "../../.env") });
  const serviceAccount = loadServiceAccountFromEnv();

  if (!serviceAccount) {
    throw new Error(
      "Firebase credentials not configured. Set FIREBASE_SERVICE_ACCOUNT_BASE64 in .env " +
        "(base64 of the full service account JSON file)."
    );
  }

  if (!serviceAccount.project_id || !serviceAccount.private_key || !serviceAccount.client_email) {
    throw new Error(
      "Service account JSON is missing required fields: project_id, private_key, or client_email"
    );
  }

  const app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  console.log("✅ Firebase Admin SDK initialized successfully");
  return app;
}

export function getFirebaseAdmin() {
  if (admin.apps.length === 0) {
    try {
      initFirebase();
    } catch (err) {
      console.error("❌ getFirebaseAdmin failed to initialize:", err.message);
    }
  }
  return admin;
}

let firebaseApp;
try {
  firebaseApp = initFirebase();
} catch (error) {
  console.error("❌ Firebase Admin SDK initialization error:", error.message);
  console.warn("⚠️  Push notifications will not work until FIREBASE_SERVICE_ACCOUNT_BASE64 is set in .env.");
}

export default firebaseApp;
export { admin };
