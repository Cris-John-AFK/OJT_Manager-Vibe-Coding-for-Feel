import { auth, db } from './firebase';
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    updateProfile,
    GoogleAuthProvider,
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult
} from "firebase/auth";
import { doc, setDoc, getDoc } from "firebase/firestore";

const googleProvider = new GoogleAuthProvider();

export function setupAuthListeners(onLogin, onLogout) {
    // 1. Check for redirect results (crucial for Google login on mobile)
    getRedirectResult(auth).then(async (result) => {
        if (result?.user) {
            console.log("Redirect login success:", result.user);
            await handleNewUser(result.user);
            await handleUserDoc(result.user, onLogin);
        }
    }).catch(err => console.error("Redirect Auth Error:", err));


    // 2. Regular Auth observer
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            await handleUserDoc(user, onLogin);
        } else {
            localStorage.removeItem('cached_user_role');
            localStorage.removeItem('cached_user_name');
            onLogout();
        }
    });
}

async function handleUserDoc(user, onLogin) {
    try {
        // Try to get cached data first if we are offline
        const cachedRole = localStorage.getItem('cached_user_role');
        const cachedName = localStorage.getItem('cached_user_name');

        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
            const data = userDoc.data();
            // Cache it for offline use
            localStorage.setItem('cached_user_role', data.role || '');
            localStorage.setItem('cached_user_name', data.name || user.displayName || '');
            onLogin({ ...user, ...data });
        } else {
            // If offline, use cached data if available
            if (!navigator.onLine && cachedRole) {
                onLogin({ ...user, role: cachedRole, name: cachedName });
            } else {
                onLogin(user);
            }
        }
    } catch (e) {
        console.error("Error fetching user data:", e);
        const cachedRole = localStorage.getItem('cached_user_role');
        const cachedName = localStorage.getItem('cached_user_name');
        if (cachedRole) {
            onLogin({ ...user, role: cachedRole, name: cachedName });
        } else {
            onLogin(user);
        }
    }
}

export async function registerUser(email, password, name, role, classCode = '') {
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        await updateProfile(user, { displayName: name });
        await setDoc(doc(db, "users", user.uid), {
            name, email, role, classCode, createdAt: new Date().toISOString()
        });
        localStorage.setItem('cached_user_role', role);
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
        localStorage.clear(); // Clear all caches on logout
        await signOut(auth);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export async function loginWithGoogle() {
    try {
        console.log("Starting Google Login...");
        if (window.Capacitor?.isNative) {
            // Force Redirect for Native - Popup is too unstable for browser context switch
            await signInWithRedirect(auth, googleProvider);
            return { success: true };
        } else {
            const result = await signInWithPopup(auth, googleProvider);
            const user = result.user;
            await handleNewUser(user);
            return { success: true, user };
        }
    } catch (error) {
        console.error("Google Login Error:", error);
        return { success: false, error: error.message };
    }
}

async function handleNewUser(user) {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (!userDoc.exists()) {
        await setDoc(doc(db, "users", user.uid), {
            name: user.displayName, email: user.email, role: 'student', createdAt: new Date().toISOString()
        });
    }
}

