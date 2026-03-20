import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let app: App;
let db: Firestore;

function init() {
  if (getApps().length > 0) {
    app = getApps()[0];
  } else {
    const projectId = process.env.FB_ADMIN_PROJECT_ID;
    const clientEmail = process.env.FB_ADMIN_CLIENT_EMAIL;
    const privateKey = process.env.FB_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error("Missing Firebase Admin credentials in env");
    }

    app = initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    });
  }
  db = getFirestore(app);
}

export function getDb(): Firestore {
  if (!db) init();
  return db;
}
