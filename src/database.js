import initSqlJs from 'sql.js';
import localforage from 'localforage';

let db = null;
let SQL = null;
const DB_KEY = 'ojt_dtr_database_v3'; // Bumped key to ensure absolutely clean slate

export async function initDatabase() {
    if (db) return db;

    try {
        SQL = await initSqlJs({ locateFile: () => `sql-wasm.wasm` });
        const savedDb = await localforage.getItem(DB_KEY);

        if (savedDb) {
            try {
                db = new SQL.Database(new Uint8Array(savedDb));
                createTables(); // Ensure schema is up to date safely
            } catch (e) {
                console.error("Corrupted DB, starting fresh", e);
                db = new SQL.Database();
                createTables();
            }
        } else {
            console.log("No existing DB found, creating new one.");
            db = new SQL.Database();
            createTables();
        }
    } catch (err) {
        console.error("FATAL initDatabase Error:", err);
    }

    return db;
}

function createTables() {
    try {
        db.run(`
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE IF NOT EXISTS logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT,
                time_in TEXT,
                time_out TEXT,
                duration REAL,
                status TEXT,
                iso_start TEXT,
                paused_at TEXT,
                total_paused_ms INTEGER DEFAULT 0,
                notes TEXT
            );
            INSERT OR IGNORE INTO settings (key, value) VALUES ('goal_hours', '600');
        `);
        // Migration: ensure notes column exists
        try { db.run("ALTER TABLE logs ADD COLUMN notes TEXT"); } catch (e) { }
    } catch (err) {
        console.error("createTables error:", err);
    }
}

export async function saveDatabase() {
    if (db) {
        try {
            const data = db.export();
            await localforage.setItem(DB_KEY, data.buffer);
        } catch (err) {
            console.error("Save error:", err);
        }
    }
}

export function getLogs(limit = 20) {
    try {
        const query = limit ? `SELECT * FROM logs WHERE status = 'completed' ORDER BY id DESC LIMIT ${limit}` : `SELECT * FROM logs WHERE status = 'completed' ORDER BY id DESC`;
        const res = db.exec(query);
        if (res.length === 0 || !res[0].values) return [];
        const colKey = Object.keys(res[0]).find(k => k !== 'values') || 'columns';
        const columns = res[0][colKey] || ['id', 'date', 'time_in', 'time_out', 'duration', 'status', 'iso_start', 'paused_at', 'total_paused_ms', 'notes'];

        return res[0].values.map(row => {
            const obj = {};
            columns.forEach((col, i) => obj[col] = row[i]);
            return obj;
        });
    } catch (e) {
        console.error("getLogs error:", e);
        return [];
    }
}

export function addLog(date, timeIn, isoStart) {
    try {
        console.log("addLog called with:", date, timeIn, isoStart);
        db.run(`INSERT INTO logs (date, time_in, status, iso_start) VALUES ('${date}', '${timeIn}', 'active', '${isoStart}')`);
        saveDatabase();
        console.log("addLog success!");
    } catch (err) {
        console.error("addLog ERROR:", err);
    }
}

export function updateLog(id, timeOut, duration, notes = '') {
    try {
        // Use parameterized query-like strings to be safe with notes
        const safeNotes = notes.replace(/'/g, "''");
        db.run(`UPDATE logs SET time_out = '${timeOut}', duration = ${duration}, notes = '${safeNotes}', status = 'completed' WHERE id = ${id}`);
        saveDatabase();
    } catch (err) {
        console.error("updateLog ERROR:", err);
    }
}

export function getActiveSession() {
    try {
        const res = db.exec("SELECT * FROM logs WHERE status IN ('active', 'paused') ORDER BY id DESC LIMIT 1");
        if (res.length === 0 || !res[0].values || res[0].values.length === 0) return null;

        const colKey = Object.keys(res[0]).find(k => k !== 'values') || 'columns';
        const columns = res[0][colKey] || ['id', 'date', 'time_in', 'time_out', 'duration', 'status', 'iso_start', 'paused_at', 'total_paused_ms'];

        const row = res[0].values[0];
        const obj = {};
        columns.forEach((col, i) => obj[col] = row[i]);
        return obj;
    } catch (e) {
        console.error("getActiveSession ERROR:", e);
        return null;
    }
}

export function getSettings() {
    try {
        const res = db.exec("SELECT * FROM settings");
        const settings = {};
        if (res.length > 0) {
            res[0].values.forEach(row => settings[row[0]] = row[1]);
        }
        return settings;
    } catch (e) {
        return { goal_hours: '600' };
    }
}

export function updateSetting(key, value) {
    try {
        db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('${key}', '${value}')`);
        saveDatabase();
    } catch (err) {
        console.error("updateSetting ERROR:", err);
    }
}

export function getTotalRenderedHours() {
    try {
        const res = db.exec("SELECT SUM(duration) FROM logs WHERE status = 'completed'");
        return res.length > 0 && res[0].values[0][0] ? parseFloat(res[0].values[0][0]) : 0;
    } catch (e) { return 0; }
}

export async function clearAllData() {
    try {
        await localforage.removeItem('ojt_dtr_database');
        await localforage.removeItem('ojt_dtr_database_v2');
        await localforage.removeItem('ojt_dtr_database_v3');
        await localforage.clear();
        db = new SQL.Database();
        createTables();
        window.location.reload();
    } catch (e) {
        console.error("clearAllData Error:", e);
        window.location.reload();
    }
}

export function pauseLog(id, isoNow) {
    try {
        db.run(`UPDATE logs SET status = 'paused', paused_at = '${isoNow}' WHERE id = ${id}`);
        saveDatabase();
    } catch (err) {
        console.error("pauseLog ERROR:", err);
    }
}

export function resumeLog(id, isoNow) {
    try {
        const res = db.exec(`SELECT paused_at, total_paused_ms FROM logs WHERE id = ${id}`);
        if (res.length > 0) {
            const pausedAt = new Date(res[0].values[0][0]);
            const currentPausedMs = res[0].values[0][1] || 0;
            const sessionPausedMs = new Date(isoNow) - pausedAt;
            const total = currentPausedMs + sessionPausedMs;
            db.run(`UPDATE logs SET status = 'active', paused_at = NULL, total_paused_ms = ${total} WHERE id = ${id}`);
            saveDatabase();
        }
    } catch (err) {
        console.error("resumeLog ERROR:", err);
    }
}

export function exportDatabase() {
    const data = db.export();
    const blob = new Blob([data.buffer], { type: "application/x-sqlite3" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ojt_dtr_backup.sqlite";
    a.click();
}
