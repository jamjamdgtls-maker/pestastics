// ============================================================
// Firebase config for the workorder-8d44c project
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDzN6PTLKBlq6jIE8aBMegvcL-qJCKqzMc",
  authDomain: "workorder-8d44c.firebaseapp.com",
  databaseURL: "https://workorder-8d44c-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "workorder-8d44c",
  storageBucket: "workorder-8d44c.firebasestorage.app",
  messagingSenderId: "637630862405",
  appId: "1:637630862405:web:75ac6faae8804561f4bf2c"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
