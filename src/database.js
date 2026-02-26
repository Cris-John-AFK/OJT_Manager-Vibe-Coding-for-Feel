import initSqlJs from 'sql.js';
import localforage from 'localforage';

let db = null;
let SQL = null;
const DB_KEY = 'ojt_dtr_database_v3'; // Bumped key to ensure absolutely clean slate

export async function initDatabase() {
    if (db) return db;

    try {
        console.log("Initializing SQL.js...");
        // Use CDN fallback to ensure WASM loads even if local path fails on Android
        const wasmPath = `https://sql.js.org/dist/sql-wasm.wasm`;

        try {
            SQL = await initSqlJs({
                locateFile: (file) => file.endsWith('.wasm') ? wasmPath : file
            });
            console.log("SQL.js loaded from CDN fallback.");
        } catch (wasmErr) {
            console.warn("CDN WASM failed, trying local...");
            SQL = await initSqlJs({
                locateFile: (file) => file
            });
        }

        console.log("SQL.js loaded, checking localForage...");
        const savedDb = await localforage.getItem(DB_KEY);

        if (savedDb) {
            try {
                console.log("Found existing DB, size: " + savedDb.byteLength);
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
            await saveDatabase(); // Persist initial state
        }
        // Auto-save interval (every 5 minutes) as fallback
        setInterval(() => {
            if (typeof saveDatabase === 'function') saveDatabase();
        }, 5 * 60 * 1000);
        console.log("Database Ready!");
    } catch (err) {
        console.error("CRITICAL initDatabase Error:", err);
        // Emergency Fallback: If WASM fails, try one more time or use memory DB
        if (SQL) {
            db = new SQL.Database();
            createTables();
        } else {
            // Last resort: If even SQL didn't load, we can't do much but wait
            // but we'll try to re-init after a delay if asked.
        }
    }

    return db;
}

function createTables() {
    if (!db) return;
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
                notes TEXT,
                deleted_at TEXT
            );
            INSERT OR IGNORE INTO settings (key, value) VALUES ('goal_hours', '600');
        `);
        // Migration: ensure notes and deleted_at columns exist
        try { db.run("ALTER TABLE logs ADD COLUMN notes TEXT"); } catch (e) { }
        try { db.run("ALTER TABLE logs ADD COLUMN deleted_at TEXT"); } catch (e) { }
    } catch (err) {
        console.error("createTables error:", err);
    }

    // Migration: Normalize all dates to ISO YYYY-MM-DD for consistent sorting
    try {
        const res = db.exec("SELECT id, date FROM logs WHERE date LIKE '%/%'");
        if (res.length > 0 && res[0].values) {
            console.log("Migrating fragmented dates to ISO format...");
            res[0].values.forEach(row => {
                const [id, oldDate] = row;
                const parts = oldDate.split('/');
                if (parts.length === 3) {
                    let [m, d, y] = parts;
                    if (y.length === 2) y = '20' + y;
                    const isoDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
                    db.run(`UPDATE logs SET date = '${isoDate}' WHERE id = ${id}`);
                }
            });
            saveDatabase();
        }
        // Force sync iso_start for any logs missing it or with broken year
        db.run(`UPDATE logs SET iso_start = date || 'T' || 
                CASE 
                    WHEN time_in LIKE '%PM%' THEN 
                        printf('%02d', (CAST(substr(time_in, 1, instr(time_in, ':')-1) AS INT) % 12) + 12)
                    ELSE 
                        printf('%02d', CAST(substr(time_in, 1, instr(time_in, ':')-1) AS INT) % 12)
                END || substr(time_in, instr(time_in, ':'), 3) || ':00'
                WHERE iso_start IS NULL OR substr(iso_start, 1, 4) != substr(date, 1, 4)`);

        // Emergency UX fix: User accidentally logged an entry as 2025 instead of 2026, causing sorting confusion.
        db.run(`UPDATE logs SET date = '2026' || substr(date, 5), iso_start = '2026' || substr(iso_start, 5) WHERE date LIKE '2025-%'`);

        saveDatabase();

    } catch (e) {
        console.warn("Date migration skipped:", e);
    }
}


export async function saveDatabase() {
    if (db) {
        try {
            const data = db.export();
            await localforage.setItem(DB_KEY, data.buffer);
            console.log("Local database saved successfully.");
        } catch (err) {
            console.error("Save error:", err);
        }
    }
}

export function getLogs(monthFilter = null, skipLimit = false) {

    if (!db) return [];
    try {
        let query = `SELECT * FROM logs WHERE status = 'completed' AND deleted_at IS NULL`;

        if (monthFilter && monthFilter !== '') {
            const [y, m] = monthFilter.split('-');
            const mInt = parseInt(m);
            query += ` AND (
                date LIKE '${y}-${m}%' OR 
                date LIKE '${mInt}/%/${y}' OR 
                date LIKE '0${mInt}/%/${y}' OR
                date LIKE '%/${mInt}/%${y}' OR
                date LIKE '%/0${mInt}/%${y}'
            )`;
        }


        // Sorting: Order by date first, then iso_start (Newest First)
        query += ` ORDER BY date DESC, iso_start DESC, id DESC`;


        // If no filter and not skipping limit, limit to 50 for performance
        if ((!monthFilter || monthFilter === '') && !skipLimit) query += ` LIMIT 50`;



        const res = db.exec(query);
        if (res.length === 0 || !res[0].values) return [];
        const columns = res[0].columns || ['id', 'date', 'time_in', 'time_out', 'duration', 'status', 'iso_start', 'paused_at', 'total_paused_ms', 'notes', 'deleted_at'];

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


export function getArchivedLogs() {
    if (!db) return [];
    try {
        const res = db.exec(`SELECT * FROM logs WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`);
        if (res.length === 0 || !res[0].values) return [];
        const columns = res[0].columns || ['id', 'date', 'time_in', 'time_out', 'duration', 'status', 'iso_start', 'paused_at', 'total_paused_ms', 'notes', 'deleted_at'];

        return res[0].values.map(row => {
            const obj = {};
            columns.forEach((col, i) => obj[col] = row[i]);
            return obj;
        });
    } catch (e) {
        console.error("getArchivedLogs error:", e);
        return [];
    }
}

export function archiveLog(id) {
    if (!db) return false;
    try {
        const isoNow = new Date().toISOString();
        db.run(`UPDATE logs SET deleted_at = '${isoNow}' WHERE id = ${id}`);
        saveDatabase();
        return true;
    } catch (e) {
        console.error("archiveLog error:", e);
        return false;
    }
}

export function recoverLog(id) {
    if (!db) return false;
    try {
        db.run(`UPDATE logs SET deleted_at = NULL WHERE id = ${id}`);
        saveDatabase();
        return true;
    } catch (e) {
        console.error("recoverLog error:", e);
        return false;
    }
}

export function permanentlyDeleteLog(id) {
    if (!db) return false;
    try {
        db.run(`DELETE FROM logs WHERE id = ${id}`);
        saveDatabase();
        return true;
    } catch (e) {
        console.error("permanentlyDeleteLog error:", e);
        return false;
    }
}

export function cleanupOldArchivedLogs() {
    if (!db) return;
    try {
        // Find logs deleted more than 30 days ago
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const isoLimit = thirtyDaysAgo.toISOString();

        db.run(`DELETE FROM logs WHERE deleted_at < '${isoLimit}'`);
        saveDatabase();
        console.log("Cleanup of old archived logs completed.");
    } catch (e) {
        console.error("cleanupOldArchivedLogs error:", e);
    }
}

export function addLog(date, timeIn, isoStart) {
    if (!db) {
        console.error("Database not initialized during addLog!");
        return false;
    }
    try {
        // Universal YYYY-MM-DD for storage to avoid locale issues
        const isoDate = new Date(isoStart).toISOString().split('T')[0];
        console.log("addLog called with:", isoDate, timeIn, isoStart);
        db.run(`INSERT INTO logs (date, time_in, status, iso_start) VALUES ('${isoDate}', '${timeIn}', 'active', '${isoStart}')`);
        saveDatabase();
        console.log("addLog success!");
        return true;
    } catch (err) {
        console.error("addLog ERROR:", err);
        return false;
    }
}



export function updateLog(id, updates) {
    if (!db) return false;
    try {
        const fields = [];
        // Handle variations in parameter names (time_in vs timeIn)
        const mapping = {
            date: 'date',
            timeIn: 'time_in',
            time_in: 'time_in',
            timeOut: 'time_out',
            time_out: 'time_out',
            duration: 'duration',
            status: 'status',
            notes: 'notes',
            isoStart: 'iso_start',
            iso_start: 'iso_start'
        };

        for (const [key, value] of Object.entries(updates)) {
            const dbColumn = mapping[key];
            if (dbColumn) {
                if (typeof value === 'string') {
                    const safeValue = value.replace(/'/g, "''");
                    fields.push(`${dbColumn} = '${safeValue}'`);
                } else if (value === null) {
                    fields.push(`${dbColumn} = NULL`);
                } else {
                    fields.push(`${dbColumn} = ${value}`);
                }
            }
        }

        if (fields.length > 0) {
            db.run(`UPDATE logs SET ${fields.join(', ')} WHERE id = ${id}`);
            saveDatabase();
        }
        return true;
    } catch (err) {
        console.error("updateLog ERROR:", err);
        return false;
    }
}

export function insertManualLog({ date, timeIn, timeOut, duration, notes }) {
    if (!db) return false;
    try {
        const safeNotes = (notes || "").replace(/'/g, "''");
        // Create a sortable iso_start for manual entries
        const [h, m] = timeIn.split(' ')[0].split(':');
        let hrs = parseInt(h);
        if (timeIn.includes('PM') && hrs < 12) hrs += 12;
        if (timeIn.includes('AM') && hrs === 12) hrs = 0;
        const isoStart = `${date}T${String(hrs).padStart(2, '0')}:${m}:00`;

        db.run(`INSERT INTO logs (date, time_in, time_out, duration, notes, status, iso_start) 
                VALUES ('${date}', '${timeIn}', '${timeOut}', ${duration}, '${safeNotes}', 'completed', '${isoStart}')`);

        saveSqlDatabase();
        return true;
    } catch (err) {
        console.error("insertManualLog ERROR:", err);
        return false;
    }
}


// ... rest of the functions ...
export function getActiveSession() {
    if (!db) return null;
    try {
        const res = db.exec("SELECT * FROM logs WHERE status IN ('active', 'paused') ORDER BY id DESC LIMIT 1");
        if (res.length === 0 || !res[0].values || res[0].values.length === 0) return null;

        const columns = res[0].columns || ['id', 'date', 'time_in', 'time_out', 'duration', 'status', 'iso_start', 'paused_at', 'total_paused_ms'];

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
    if (!db) return { goal_hours: '600' };
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
    if (!db) return;
    try {
        db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('${key}', '${value}')`);
        saveSqlDatabase();
    } catch (err) {
        console.error("updateSetting ERROR:", err);
    }
}

export function getTotalRenderedHours() {
    if (!db) return 0;
    try {
        const res = db.exec("SELECT SUM(duration) FROM logs WHERE status = 'completed' AND deleted_at IS NULL");
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
        saveSqlDatabase();
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
