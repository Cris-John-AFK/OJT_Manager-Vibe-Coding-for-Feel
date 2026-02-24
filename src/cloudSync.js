import { db, auth } from './firebase';
import { doc, setDoc, collection, addDoc, query, where, getDocs, deleteDoc } from "firebase/firestore";

export async function syncLocalDataToCloud(logs, settings) {
    const user = auth.currentUser;
    if (!user) return;

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
        for (const log of logs) {
            // We use safe IDs or timestamps to avoid duplicates
            const logId = `${log.date}_${log.time_in}`.replace(/\//g, '-');
            await setDoc(doc(logsRef, logId), {
                ...log,
                syncedAt: new Date().toISOString()
            });
        }

        console.log("Cloud sync complete!");
        return { success: true };
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
