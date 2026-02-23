import './style.css'
import {
  createIcons, Play, Square, Settings, X, Trash2, Download, LayoutDashboard, History, User, Pause
} from 'lucide';
import {
  initDatabase, getLogs, addLog, updateLog, getActiveSession,
  getSettings, updateSetting, getTotalRenderedHours, clearAllData,
  exportDatabase, pauseLog, resumeLog
} from './database';

// Global Error Handler for the user
window.onerror = function (msg, url, line) {
  console.error("Window Error:", msg, line);
  // Silent fail but logged
};

const ICON_LIB = { Play, Square, Settings, X, Trash2, Download, LayoutDashboard, History, User, Pause };

let timerInterval = null;

async function startApp() {
  console.log("DTR App Initializing...");
  try {
    await initDatabase();
    console.log("Database initialized.");

    setupEventListeners();
    updateAppUI();

    // Reveal App Logic
    const splash = document.getElementById('splash-screen');
    const root = document.getElementById('root');

    setTimeout(() => {
      if (splash) {
        splash.style.opacity = '0';
        splash.style.pointerEvents = 'none';
      }
      setTimeout(() => {
        splash?.classList.add('hidden');
        root?.classList.remove('hidden');
      }, 800);
    }, 1500);

  } catch (error) {
    console.error("App Crash:", error);
  }
}

function setupEventListeners() {
  console.log("Setting up event listeners...");
  const listen = (id, fn) => Object.assign(document.getElementById(id) || {}, { onclick: (e) => { console.log(`[CLICK] ${id} fired!`); fn(e); } });

  listen('time-in-btn', handleTimeIn);
  listen('time-out-btn', handleTimeOut);
  listen('pause-btn', handlePauseResume);
  listen('settings-btn', () => document.getElementById('settings-modal')?.classList.remove('hidden'));
  listen('close-settings', () => document.getElementById('settings-modal')?.classList.add('hidden'));

  listen('save-settings', () => {
    const input = document.getElementById('goal-hours-input');
    const val = input?.value;
    if (val && !isNaN(val)) {
      updateSetting('goal_hours', val);
      document.getElementById('settings-modal')?.classList.add('hidden');
      setTimeout(() => window.location.reload(), 100);
    }
  });

  listen('clear-data', () => {
    if (confirm('Erase everything?')) clearAllData();
  });

  listen('export-db', exportDatabase);

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    };
  });
}

function updateAppUI() {
  try {
    const settings = getSettings();
    const goal = parseFloat(settings.goal_hours || 600);
    const done = getTotalRenderedHours();

    // Update Stats
    setText('rendered-hours', `${done.toFixed(1)}h`);
    setText('goal-hours-display', `${goal}h`);
    setText('remaining-hours', `${Math.max(0, goal - done).toFixed(1)}h`);

    const progress = goal > 0 ? Math.min(100, (done / goal) * 100) : 0;
    const bar = document.getElementById('progress-bar');
    if (bar) bar.style.strokeDashoffset = 283 - (283 * progress) / 100;

    // Render Recent Logs
    const logs = getLogs();
    const list = document.getElementById('logs-list');
    if (list) {
      if (logs.length === 0) {
        list.innerHTML = `<div class="empty-state"><p>No logs found.</p></div>`;
      } else {
        list.innerHTML = logs.map(log => `
                    <div class="log-item">
                        <div class="log-date">
                            <span class="date-text">${log.date || '---'}</span>
                            <span class="time-range">${log.time_in} - ${log.time_out}</span>
                        </div>
                        <div class="log-duration">${parseFloat(log.duration).toFixed(2)}h</div>
                    </div>
                `).join('');
      }
    }

    // Handle Active Session State
    const active = getActiveSession();
    const inBtn = document.getElementById('time-in-btn');
    const outBtn = document.getElementById('time-out-btn');
    const pauseBtn = document.getElementById('pause-btn');
    const card = document.getElementById('active-session-card');

    if (active) {
      inBtn?.classList.add('hidden');
      outBtn?.classList.remove('disabled');
      outBtn?.classList.add('active');
      if (outBtn) outBtn.disabled = false;

      pauseBtn?.classList.remove('hidden');
      if (active.status === 'paused') {
        pauseBtn.innerHTML = '<i data-lucide="play"></i><span>Resume</span>';
        pauseBtn.className = 'action-btn resume';
        card?.classList.remove('hidden'); // Keep visible so user sees the frozen timer!
        stopSessionTimer();
      } else {
        pauseBtn.innerHTML = '<i data-lucide="pause"></i><span>Pause</span>';
        pauseBtn.className = 'action-btn pause';
        card?.classList.remove('hidden');
        runSessionTimer(active);
      }
    } else {
      inBtn?.classList.remove('hidden');
      outBtn?.classList.add('disabled');
      outBtn?.classList.remove('active');
      if (outBtn) outBtn.disabled = true;
      pauseBtn?.classList.add('hidden');
      card?.classList.add('hidden');
      stopSessionTimer();
    }

    createIcons({ icons: ICON_LIB });
  } catch (e) { console.error("UI Update Failed", e); }
}

function handleTimeIn() {
  const now = new Date();
  addLog(now.toLocaleDateString(), now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), now.toISOString());
  updateAppUI();
}

function handleTimeOut() {
  const active = getActiveSession();
  if (!active) return;
  const now = new Date();

  let start = new Date(active.iso_start);
  if (isNaN(start.getTime())) start = now; // Fallback

  // Calculate total raw milliseconds passed since "Time In"
  let diffMs = now.getTime() - start.getTime();

  // Subtract any previously accumulated pause time in milliseconds
  const pastPausedMs = parseInt(active.total_paused_ms) || 0;
  diffMs -= pastPausedMs;

  // If currently paused right now, subtract the time spent paused in this current pause block
  if (active.status === 'paused' && active.paused_at) {
    const currentPauseStart = new Date(active.paused_at).getTime();
    diffMs -= (now.getTime() - currentPauseStart);
  }

  // Calculate hours nicely, prevent negatives
  const hours = Math.max(0, diffMs / (1000 * 60 * 60));

  updateLog(active.id, now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), hours);
  updateAppUI();
}

function handlePauseResume() {
  const active = getActiveSession();
  if (!active) return;
  const iso = new Date().toISOString();
  active.status === 'paused' ? resumeLog(active.id, iso) : pauseLog(active.id, iso);
  updateAppUI();
}

function runSessionTimer(active) {
  if (timerInterval) clearInterval(timerInterval);

  const startObj = new Date(active.iso_start);
  const startTime = isNaN(startObj.getTime()) ? Date.now() : startObj.getTime();
  const pastPausedMs = parseInt(active.total_paused_ms) || 0;

  const el = document.getElementById('session-timer');

  timerInterval = setInterval(() => {
    let diffMs = Date.now() - startTime - pastPausedMs;

    // If the session is currently paused, we subtract the ongoing pause duration
    // so the timer appears completely frozen precisely where it was stopped.
    if (active.status === 'paused' && active.paused_at) {
      const pauseStart = new Date(active.paused_at).getTime();
      diffMs -= (Date.now() - pauseStart);
    }

    if (diffMs < 0) diffMs = 0;

    const h = Math.floor(diffMs / (1000 * 60 * 60)).toString().padStart(2, '0');
    const m = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60)).toString().padStart(2, '0');
    const s = Math.floor((diffMs % (1000 * 60)) / 1000).toString().padStart(2, '0');

    if (el) el.textContent = `${h}:${m}:${s}`;
  }, 1000);
}

function stopSessionTimer() {
  clearInterval(timerInterval);
  setText('session-timer', '00:00:00');
}

function setText(id, txt) {
  const el = document.getElementById(id);
  if (el) el.textContent = txt;
}

startApp();
