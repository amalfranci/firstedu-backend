import dotenv from "dotenv";
dotenv.config();
import admin from "firebase-admin";

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
  const json = Buffer.from(base64, "base64").toString("utf8");
  return normalizePrivateKey(JSON.parse(json));
}

let firebaseApp;

try {
  if (admin.apps.length === 0) {
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

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    console.log("✅ Firebase Admin SDK initialized successfully");
  } else {
    firebaseApp = admin.app();
  }
} catch (error) {
  console.error("❌ Firebase Admin SDK initialization error:", error.message);
  console.warn("⚠️  Push notifications will not work until FIREBASE_SERVICE_ACCOUNT_BASE64 is set.");
}

export default firebaseApp;
export { admin };
