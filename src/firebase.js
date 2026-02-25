import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, enableIndexedDbPersistence } from "firebase/firestore";

// PASTE YOUR FIREBASE CONFIG HERE
const firebaseConfig = {
    apiKey: "AIzaSyDRzQdzCNhbKhT0Nu_erUTFy0jHKjZNBW8",
    authDomain: "ojt-dtr-manager.firebaseapp.com",
    projectId: "ojt-dtr-manager",
    storageBucket: "ojt-dtr-manager.firebasestorage.app",
    messagingSenderId: "752511126081",
    appId: "1:752511126081:web:87e287d42dd5ba5c7654c0",
    measurementId: "G-R59X6QCSRS"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Enable Offline Persistence
enableIndexedDbPersistence(db).catch((err) => {
    if (err.code === 'failed-precondition') {
        console.warn("Multiple tabs open, persistence can only be enabled in one tab at a time.");
    } else if (err.code === 'unimplemented') {
        console.warn("The current browser does not support all of the features required to enable persistence");
    }
});

