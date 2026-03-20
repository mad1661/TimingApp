import {
  initializeApp,
  getApps,
  cert,
  applicationDefault,
  type App,
} from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let app: App;
let db: Firestore;

function init() {
  if (getApps().length > 0) {
    app = getApps()[0];
  } else {
    const projectId = process.env.FB_ADMIN_PROJECT_ID || "nhra-timing-app";
    const clientEmail = process.env.FB_ADMIN_CLIENT_EMAIL;
    const privateKey = process.env.FB_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

    if (clientEmail && privateKey) {
      app = initializeApp({
        credential: cert({ projectId, clientEmail, privateKey }),
      });
    } else {
      app = initializeApp({
        credential: applicationDefault(),
        projectId,
      });
    }
  }
  db = getFirestore(app);
}

export function getDb(): Firestore {
  if (!db) init();
  return db;
}
