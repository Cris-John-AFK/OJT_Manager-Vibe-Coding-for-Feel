import { auth, db } from './firebase';
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    updateProfile,
    GoogleAuthProvider,
    signInWithPopup
} from "firebase/auth";
import { doc, setDoc, getDoc } from "firebase/firestore";

const googleProvider = new GoogleAuthProvider();

export function setupAuthListeners(onLogin, onLogout) {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            // Fetch additional user data from Firestore
            try {
                const userDoc = await getDoc(doc(db, "users", user.uid));
                if (userDoc.exists()) {
                    onLogin({ ...user, ...userDoc.data() });
                } else {
                    onLogin(user);
                }
            } catch (e) {
                console.error("Error fetching user data:", e);
                onLogin(user);
            }
        } else {
            onLogout();
        }
    });
}

export async function registerUser(email, password, name, role, classCode = '') {
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Update Firebase Profile
        await updateProfile(user, { displayName: name });

        // Store user role and info in Firestore
        await setDoc(doc(db, "users", user.uid), {
            name,
            email,
            role,
            classCode,
            createdAt: new Date().toISOString()
        });

        return { success: true, user };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export async function loginUser(email, password) {
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        return { success: true, user: userCredential.user };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export async function logoutUser() {
    try {
        await signOut(auth);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export async function loginWithGoogle() {
    try {
        const result = await signInWithPopup(auth, googleProvider);
        const user = result.user;

        // Check if user exists in Firestore
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (!userDoc.exists()) {
            // If new user via Google, default to Student role
            await setDoc(doc(db, "users", user.uid), {
                name: user.displayName,
                email: user.email,
                role: 'student',
                createdAt: new Date().toISOString()
            });
        }
        return { success: true, user };
    } catch (error) {
        return { success: false, error: error.message };
    }
}
