import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

console.log("Initializing Firebase with project:", firebaseConfig.projectId);
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
console.log("Firestore initialized with databaseId:", firebaseConfig.firestoreDatabaseId);
export const googleProvider = new GoogleAuthProvider();

export const signIn = () => signInWithPopup(auth, googleProvider);
export const logOut = () => signOut(auth);

async function testConnection() {
  try {
    // Only test if we have a db instance
    if (db) {
      await getDocFromServer(doc(db, 'test', 'connection'));
      console.log("Firebase connection test successful");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. The client appears to be offline.");
    } else {
      console.warn("Connection test note:", error instanceof Error ? error.message : "Handled exception");
    }
  }
}
testConnection();
