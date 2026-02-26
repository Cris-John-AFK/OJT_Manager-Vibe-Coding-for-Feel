import { db, auth, storage } from './firebase';
import { doc, setDoc, collection, addDoc, query, where, getDocs, deleteDoc, getDoc, updateDoc, deleteField } from "firebase/firestore";
import { ref, uploadString, getDownloadURL } from "firebase/storage";

export async function syncLocalDataToCloud(logs, settings) {
    const user = auth.currentUser;
    if (!user) return;

    // On localhost dev, Firebase Storage CORS blocks all uploads — skip them entirely
    const isLocalhost = typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
        !window.Capacitor?.isNative;

    try {
        // 1. Sync User Stats/Settings to their main doc
        await setDoc(doc(db, "users", user.uid), {
            totalRendered: logs.reduce((sum, log) => sum + (parseFloat(log.duration) || 0), 0),
            goalHours: parseFloat(settings.goal_hours) || 600,
            lastSync: new Date().toISOString()
        }, { merge: true });

        // 2. Sync Logs to a sub-collection
        const logsRef = collection(db, "users", user.uid, "logs");

        // Simple strategy: Clear cloud logs and re-upload (safe for small DTR logs)
        // Or better: only upload if not exists. Let's do a simple merge.
        const statusUpdates = [];
        for (const log of logs) {
            // We use safe IDs or timestamps to avoid duplicates
            const logId = `${log.date}_${log.time_in}`.replace(/\//g, '-');
            const docRef = doc(logsRef, logId);

            const cDoc = await getDoc(docRef);
            let finalStatus = log.approval_status || 'pending';
            let finalPhotoUrl = log.photo_url || null;

            // Upload Base64 Photo to Storage if needed
            // Also check localForage for photos deferred due to CORS/network failure
            if (!finalPhotoUrl) {
                try {
                    const localforage = (await import('localforage')).default;
                    const deferred = await localforage.getItem(`pending_photo_${logId}`);
                    if (deferred) {
                        if (isLocalhost) {
                            // On localhost: can't upload to Storage (CORS), store base64 directly in Firestore
                            // Firestore doc limit is 1MB; photo base64 is ~48KB — safe
                            console.log('[Sync] Localhost: storing base64 directly in Firestore for', logId);
                            finalPhotoUrl = deferred; // data:image/jpeg;base64,...
                        } else {
                            finalPhotoUrl = deferred;
                            console.log('[Sync] Found deferred photo in localForage for', logId);
                        }
                    }
                } catch (e) { /* ignore */ }
            }

            if (finalPhotoUrl && finalPhotoUrl.startsWith('data:image')) {
                if (isLocalhost) {
                    // Keep as base64 data URL — goes straight into Firestore doc
                    console.log('[Sync] Localhost: embedding base64 photo in Firestore doc for', logId);
                    // finalPhotoUrl already set, no upload needed
                } else {
                    try {
                        console.log('[Sync] Uploading photo for log', logId, '- size:', finalPhotoUrl.length);
                        const imgRef = ref(storage, `users/${user.uid}/logs/${logId}.jpg`);
                        await uploadString(imgRef, finalPhotoUrl, 'data_url');
                        finalPhotoUrl = await getDownloadURL(imgRef);
                        console.log('[Sync] Photo uploaded OK:', finalPhotoUrl);
                        // Tell local SQLite to swap out and clean up localForage entry
                        statusUpdates.push({ id: log.id, photo_url: finalPhotoUrl });
                        try {
                            const localforage = (await import('localforage')).default;
                            await localforage.removeItem(`pending_photo_${logId}`);
                        } catch (e) { /* ignore */ }
                    } catch (e) {
                        console.error('[Sync] Photo Upload Failed:', e.code, e.message);
                    }
                }
            } else {
                if (!isLocalhost) console.log('[Sync] log', logId, 'photo_url:', finalPhotoUrl ? 'URL already' : 'NULL');
            }

            if (cDoc.exists() && cDoc.data().approval_status && cDoc.data().approval_status !== log.approval_status) {
                if (cDoc.data().approval_status !== 'pending') {
                    finalStatus = cDoc.data().approval_status;
                    statusUpdates.push({ id: log.id, approval_status: finalStatus, photo_url: finalPhotoUrl });
                }
            }

            console.log('[Sync] setDoc', logId, '| location_in:', log.location_in, '| status:', log.status);
            await setDoc(docRef, {
                ...log,
                photo_url: finalPhotoUrl,
                approval_status: finalStatus,
                syncedAt: new Date().toISOString()
            });
        }

        console.log("Cloud sync complete!");
        return { success: true, statusUpdates };
    } catch (error) {
        console.error("Sync Error:", error);
        return { success: false, error: error.message };
    }
}

export async function getStudentData(studentId) {
    try {
        const userDoc = await getDoc(doc(db, "users", studentId));
        const logsSnap = await getDocs(collection(db, "users", studentId, "logs"));
        const logs = logsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        return { ...userDoc.data(), logs };
    } catch (e) {
        console.error("Error getting student data:", e);
        return null;
    }
}

export async function fetchStudentsByClassCode(classCode) {
    if (!classCode) return [];
    try {
        const q = query(collection(db, "users"), where("role", "==", "student"), where("classCode", "==", classCode));
        const snap = await getDocs(q);

        const students = [];
        for (const studentDoc of snap.docs) {
            const data = studentDoc.data();
            // Get logs summary/stats
            const logsSnap = await getDocs(collection(db, "users", studentDoc.id, "logs"));
            const logs = logsSnap.docs.map(d => d.data());

            students.push({
                id: studentDoc.id,
                ...data,
                logs: logs,
                totalRendered: logs.reduce((sum, l) => sum + (parseFloat(l.duration) || 0), 0)
            });
        }
        return students;
    } catch (e) {
        console.error("Error fetching students:", e);
        return [];
    }
}

export async function kickStudentFromClass(studentId) {
    if (!studentId) return { success: false };
    try {
        await updateDoc(doc(db, "users", studentId), {
            classCode: ""
        });
        return { success: true };
    } catch (e) {
        console.error("Kick student error:", e);
        return { success: false, error: e.message };
    }
}

export async function createClass(teacherId, className) {
    if (!teacherId || !className) return { success: false };
    try {
        const classCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        await setDoc(doc(db, "classes", classCode), {
            name: className,
            teacherId: teacherId,
            createdAt: new Date().toISOString()
        });
        return { success: true, classCode };
    } catch (e) {
        console.error("Create class error:", e);
        return { success: false, error: e.message };
    }
}

export async function fetchTeacherClasses(teacherId) {
    if (!teacherId) return [];
    try {
        const q = query(collection(db, "classes"), where("teacherId", "==", teacherId));
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ code: d.id, ...d.data() }));
    } catch (e) {
        console.error("Fetch classes error:", e);
        return [];
    }
}
