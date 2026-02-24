import './style.css'
import {
  createIcons, Play, Square, Settings, X, Trash2, Download, LayoutDashboard, History, User, Pause, LogOut, Edit3, Check
} from 'lucide';
import {
  initDatabase, getLogs, addLog, updateLog, getActiveSession,
  getSettings, updateSetting, getTotalRenderedHours, clearAllData,
  exportDatabase, pauseLog, resumeLog
} from './database';
import { setupAuthListeners, loginUser, registerUser, logoutUser, loginWithGoogle } from './auth';
import { db, auth } from './firebase';
import { doc, updateDoc } from "firebase/firestore";
import { syncLocalDataToCloud, fetchStudentsByClassCode, getStudentData } from './cloudSync';

// Global Error Handler for the user
window.onerror = function (msg, url, line) {
  console.error("Window Error:", msg, line);
  // Silent fail but logged
};

const ICON_LIB = { Play, Square, Settings, X, Trash2, Download, LayoutDashboard, History, User, Pause, LogOut, Edit3, Check };

const listen = (id, fn) => {
  const el = document.getElementById(id);
  if (el) {
    el.onclick = (e) => {
      console.log(`[CLICK] ${id} fired!`);
      fn(e);
    };
  } else {
    // Silent fail if element doesn't exist yet
  }
};

let timerInterval = null;
let silentAudio = null;

function initMediaSession() {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', handlePauseResume);
    navigator.mediaSession.setActionHandler('pause', handlePauseResume);
    navigator.mediaSession.setActionHandler('stop', handleTimeOut);
  }
}

function updateMediaNotification(timerText) {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `OJT Timer: ${timerText}`,
      artist: 'DTR Manager',
      album: 'Active Session',
      artwork: [
        { src: 'https://placehold.co/512x512/6366f1/ffffff?text=DTR', sizes: '512x512', type: 'image/png' }
      ]
    });

    // To keep the notification alive, we need to 'play' something silent
    if (!silentAudio) {
      silentAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhAAQACABAAAABkYXRhAgAAAAEA');
      silentAudio.loop = true;
    }
  }
}

async function startApp() {
  console.log("DTR App Initializing...");
  try {
    await initDatabase();
    console.log("Database initialized.");

    setupEventListeners();
    setupAuthUI();
    updateAppUI();
    initMediaSession();

    // Setup Auth Listener
    setupAuthListeners(handleAuthLogin, handleAuthLogout);

    // Reveal Logic (Wait for Auth usually, but let splash finish)
    const splash = document.getElementById('splash-screen');
    const root = document.getElementById('root');

    setTimeout(() => {
      if (splash) {
        splash.style.opacity = '0';
        splash.style.pointerEvents = 'none';
      }
      setTimeout(() => {
        splash?.classList.add('hidden');
      }, 800);
    }, 1500);

  } catch (error) {
    console.error("App Crash:", error);
  }
}

function setupEventListeners() {
  console.log("Setting up event listeners...");

  listen('time-in-btn', handleTimeIn);
  listen('time-out-btn', handleTimeOut);
  listen('pause-btn', handlePauseResume);
  listen('settings-btn', () => document.getElementById('settings-modal')?.classList.remove('hidden'));
  listen('close-settings', () => document.getElementById('settings-modal')?.classList.add('hidden'));
  listen('logout-btn', () => document.getElementById('logout-modal')?.classList.remove('hidden'));
  listen('cancel-logout', () => document.getElementById('logout-modal')?.classList.add('hidden'));
  listen('confirm-logout-btn', async () => {
    await logoutUser();
    document.getElementById('logout-modal')?.classList.add('hidden');
  });

  listen('save-settings', () => {
    const input = document.getElementById('goal-hours-input');
    const val = input?.value;
    if (val && !isNaN(val)) {
      updateSetting('goal_hours', val);
      document.getElementById('settings-modal')?.classList.add('hidden');
      setTimeout(() => window.location.reload(), 100);
    }
  });

  listen('close-timeout', () => document.getElementById('timeout-modal')?.classList.add('hidden'));
  listen('confirm-timeout-btn', confirmTimeOut);
  listen('close-student-modal', () => document.getElementById('student-modal')?.classList.add('hidden'));
  listen('close-history', () => document.getElementById('history-modal')?.classList.add('hidden'));

  listen('view-all-btn', () => {
    const allLogs = getLogs(null);
    const list = document.getElementById('history-logs-list');
    if (list) {
      if (allLogs.length === 0) {
        list.innerHTML = `<div class="empty-state"><p>No logs found.</p></div>`;
      } else {
        list.innerHTML = allLogs.map(log => `
          <div class="log-item">
            <div class="log-date">
              <span class="date-text">${log.date || '---'}</span>
              <span class="time-range">${log.time_in || ''} - ${log.time_out || ''}</span>
            </div>
            <div class="log-duration">${parseFloat(log.duration || 0).toFixed(2)}h</div>
            ${log.notes ? `<div class="log-notes"><i data-lucide="edit-3" style="width:12px;height:12px;display:inline;margin-right:4px;"></i>${log.notes}</div>` : ''}
          </div>
        `).join('');
      }
      createIcons({ icons: ICON_LIB });
    }
    document.getElementById('history-modal')?.classList.remove('hidden');
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

function setupAuthUI() {
  const toSignup = document.getElementById('to-signup');
  const toLogin = document.getElementById('to-login');
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');

  if (toSignup) toSignup.onclick = (e) => {
    e.preventDefault();
    loginForm?.classList.add('hidden');
    signupForm?.classList.remove('hidden');
    setText('auth-subtitle', 'Create a new account');
  };

  if (toLogin) toLogin.onclick = (e) => {
    e.preventDefault();
    signupForm?.classList.add('hidden');
    loginForm?.classList.remove('hidden');
    setText('auth-subtitle', 'Login to your account');
  };

  // Login Logic
  if (loginForm) loginForm.onsubmit = async (e) => {
    e.preventDefault();
    const btn = loginForm.querySelector('button');
    const oldText = btn.textContent;
    btn.textContent = 'Logging in...';
    btn.disabled = true;

    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;
    const res = await loginUser(email, pass);

    if (!res.success) alert(res.error);
    btn.textContent = oldText;
    btn.disabled = false;
  };

  // Signup Logic
  if (signupForm) signupForm.onsubmit = async (e) => {
    e.preventDefault();
    const btn = signupForm.querySelector('button');
    const oldText = btn.textContent;
    btn.textContent = 'Creating account...';
    btn.disabled = true;

    const name = document.getElementById('signup-name').value;
    const email = document.getElementById('signup-email').value;
    const pass = document.getElementById('signup-password').value;
    const role = signupForm.querySelector('input[name="role"]:checked').value;
    const code = document.getElementById('signup-class-code').value;

    const res = await registerUser(email, pass, name, role, code);

    if (!res.success) alert(res.error);
    btn.textContent = oldText;
    btn.disabled = false;
  };

  // Google Handlers
  const handleGoogle = async () => {
    const res = await loginWithGoogle();
    if (!res.success) alert(res.error);
  };

  listen('google-login-btn', handleGoogle);
  listen('google-signup-btn', handleGoogle);

  // Google Setup Modal Handler
  listen('save-setup-btn', async () => {
    const role = document.querySelector('input[name="setup-role"]:checked').value;
    const code = document.getElementById('setup-class-code').value;
    const user = auth.currentUser;

    if (user) {
      await updateDoc(doc(db, "users", user.uid), {
        role: role,
        classCode: code
      });
      document.getElementById('google-setup-modal')?.classList.add('hidden');
      window.location.reload(); // Refresh to catch new role
    }
  });
}

function handleAuthLogin(userData) {
  console.log("Logged in:", userData);

  if (!userData.role) {
    document.getElementById('google-setup-modal')?.classList.remove('hidden');
    return;
  }

  document.getElementById('auth-container')?.classList.add('hidden');
  document.getElementById('root')?.classList.remove('hidden');

  // Role based visibility
  const isTeacher = userData.role === 'teacher';
  const teacherSection = document.getElementById('teacher-section');
  const studentMain = document.querySelector('.stats-card'); // Use this to toggle
  const actions = document.querySelector('.quick-actions');
  const activeSess = document.getElementById('active-session-card');
  const logsSess = document.querySelector('.logs-section');

  if (isTeacher) {
    teacherSection?.classList.remove('hidden');
    studentMain?.classList.add('hidden');
    actions?.classList.add('hidden');
    activeSess?.classList.add('hidden');
    logsSess?.classList.add('hidden');
    loadTeacherData(userData);
  } else {
    teacherSection?.classList.add('hidden');
    studentMain?.classList.remove('hidden');
    actions?.classList.remove('hidden');
    logsSess?.classList.remove('hidden');
  }

  // Update Header
  setText('user-display-name', userData.displayName || userData.name || 'User');
  setText('user-role-badge', userData.role || 'Student');

  const roleBadge = document.getElementById('user-role-badge');
  if (roleBadge) {
    roleBadge.className = `role-badge ${userData.role || 'student'}`;
  }

  // Initial Sync (only for students)
  if (!isTeacher) syncCloud();

  updateAppUI();
}

async function loadTeacherData(teacherData) {
  const code = teacherData.uid.substring(0, 6).toUpperCase();
  // Update the user's class code in Firestore if they don't have one
  if (!teacherData.classCode) {
    await updateDoc(doc(db, "users", teacherData.uid), { classCode: code });
  }

  const actualCode = teacherData.classCode || code;
  setText('display-class-code', actualCode);

  const students = await fetchStudentsByClassCode(actualCode);
  const list = document.getElementById('students-list');
  if (!list) return;

  if (students.length === 0) {
    list.innerHTML = `<div class="empty-state">No students found for class ${actualCode}</div>`;
  } else {
    list.innerHTML = students.map(s => {
      const progress = (s.totalRendered / (s.goalHours || 600) * 100).toFixed(0);
      return `
        <div class="student-card" onclick="window.viewStudentDetail('${s.id}')">
          <div class="student-info">
            <span class="student-name">${s.name}</span>
            <span class="student-progress">${s.totalRendered.toFixed(2)}h / ${s.goalHours || 600}h</span>
          </div>
          <div class="progress-pct">${progress}%</div>
        </div>
      `;
    }).join('');
  }
}

window.viewStudentDetail = async (studentId) => {
  const student = await getStudentData(studentId);
  if (!student) return;

  setText('modal-student-name', `${student.name}'s Progress`);
  setText('modal-student-rendered', `${(student.totalRendered || 0).toFixed(2)}h`);
  setText('modal-student-goal', `${student.goalHours || 600}h`);

  const list = document.getElementById('modal-student-logs');
  if (list) {
    if (!student.logs || student.logs.length === 0) {
      list.innerHTML = '<div class="empty-state">No logs found.</div>';
    } else {
      // Sort logs by date desc
      const sorted = [...student.logs].sort((a, b) => new Date(b.date) - new Date(a.date));
      list.innerHTML = sorted.map(log => `
        <div class="log-item">
          <div class="log-date">
            <span class="date-text">${log.date}</span>
            <span class="time-range">${log.time_in} - ${log.time_out}</span>
          </div>
          <div class="log-duration">${(parseFloat(log.duration) || 0).toFixed(2)}h</div>
          ${log.notes ? `<div class="log-notes"><i data-lucide="edit-3" style="width:12px;height:12px;display:inline;margin-right:4px;"></i>${log.notes}</div>` : ''}
        </div>
      `).join('');
      createIcons({ icons: ICON_LIB });
    }
  }

  document.getElementById('student-modal')?.classList.remove('hidden');
};

async function syncCloud() {
  const logs = getLogs();
  const settings = getSettings();
  await syncLocalDataToCloud(logs, settings);
}

function handleAuthLogout() {
  console.log("Logged out");
  document.getElementById('root')?.classList.add('hidden');
  document.getElementById('auth-container')?.classList.remove('hidden');
}

function updateAppUI() {
  try {
    const settings = getSettings();
    const goal = parseFloat(settings.goal_hours || 600);
    const active = getActiveSession();

    // Calculate effective "done" hours (completed + current active)
    let completedHours = getTotalRenderedHours();
    let currentSessionHours = 0;

    if (active && active.status !== 'paused') {
      const start = new Date(active.iso_start).getTime();
      const pastPaused = parseInt(active.total_paused_ms) || 0;
      const diffMs = Date.now() - start - pastPaused;
      currentSessionHours = Math.max(0, diffMs / (1000 * 60 * 60));
    } else if (active && active.status === 'paused') {
      const start = new Date(active.iso_start).getTime();
      const pastPaused = parseInt(active.total_paused_ms) || 0;
      const pausedAt = new Date(active.paused_at).getTime();
      const diffMs = pausedAt - start - pastPaused;
      currentSessionHours = Math.max(0, diffMs / (1000 * 60 * 60));
    }

    const totalDone = completedHours + currentSessionHours;

    // Update Stats
    setText('rendered-hours', `${totalDone.toFixed(2)}h`);
    setText('goal-hours-display', `${goal}h`);
    setText('remaining-hours', `${Math.max(0, goal - totalDone).toFixed(2)}h`);

    const progress = goal > 0 ? Math.min(100, (totalDone / goal) * 100) : 0;
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
                            <span class="time-range">${log.time_in || ''} - ${log.time_out || ''}</span>
                        </div>
                        <div class="log-duration">${parseFloat(log.duration || 0).toFixed(2)}h</div>
                        ${log.notes ? `<div class="log-notes"><i data-lucide="edit-3" style="width:12px;height:12px;display:inline;margin-right:4px;"></i>${log.notes}</div>` : ''}
                    </div>
                `).join('');
      }
    }

    // Handle Active Session State
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

  // Reset notes field
  const notesInput = document.getElementById('log-notes-input');
  if (notesInput) notesInput.value = '';

  document.getElementById('timeout-modal')?.classList.remove('hidden');
}

function confirmTimeOut() {
  const active = getActiveSession();
  if (!active) return;

  const now = new Date();
  const notes = document.getElementById('log-notes-input')?.value || '';

  let start = new Date(active.iso_start);
  if (isNaN(start.getTime())) start = now;

  let diffMs = now.getTime() - start.getTime();
  const pastPausedMs = parseInt(active.total_paused_ms) || 0;
  diffMs -= pastPausedMs;

  if (active.status === 'paused' && active.paused_at) {
    const currentPauseStart = new Date(active.paused_at).getTime();
    diffMs -= (now.getTime() - currentPauseStart);
  }

  const hours = Math.max(0, diffMs / (1000 * 60 * 60));

  updateLog(active.id, now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), hours, notes);
  document.getElementById('timeout-modal')?.classList.add('hidden');
  updateAppUI();
  syncCloud(); // Sync after timeout
}

function handlePauseResume() {
  const active = getActiveSession();
  if (!active) return;
  const iso = new Date().toISOString();
  active.status === 'paused' ? resumeLog(active.id, iso) : pauseLog(active.id, iso);

  // Handle Media Playback State
  if ('mediaSession' in navigator) {
    if (active.status === 'paused') {
      navigator.mediaSession.playbackState = 'playing';
      if (silentAudio) silentAudio.play().catch(() => { });
    } else {
      navigator.mediaSession.playbackState = 'paused';
      if (silentAudio) silentAudio.pause();
    }
  }

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

    // Update top level stats every second too!
    updateStatsOnly(active);

    // Update System Notification
    updateMediaNotification(`${h}:${m}:${s}`);
  }, 1000);

  if (silentAudio && active.status !== 'paused') {
    silentAudio.play().catch(() => { });
    navigator.mediaSession.playbackState = 'playing';
  }
}

function updateStatsOnly(active) {
  const settings = getSettings();
  const goal = parseFloat(settings.goal_hours || 600);
  const completedHours = getTotalRenderedHours();

  let currentSessionHours = 0;
  if (active && active.status !== 'paused') {
    const start = new Date(active.iso_start).getTime();
    const pastPaused = parseInt(active.total_paused_ms) || 0;
    const diffMs = Date.now() - start - pastPaused;
    currentSessionHours = Math.max(0, diffMs / (1000 * 60 * 60));
  }

  const totalDone = completedHours + currentSessionHours;
  setText('rendered-hours', `${totalDone.toFixed(2)}h`);
  setText('remaining-hours', `${Math.max(0, goal - totalDone).toFixed(2)}h`);

  const progress = goal > 0 ? Math.min(100, (totalDone / goal) * 100) : 0;
  const bar = document.getElementById('progress-bar');
  if (bar) bar.style.strokeDashoffset = 283 - (283 * progress) / 100;
}

function stopSessionTimer() {
  clearInterval(timerInterval);
  setText('session-timer', '00:00:00');

  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = 'none';
    if (silentAudio) {
      silentAudio.pause();
      silentAudio.currentTime = 0;
    }
  }
}

function setText(id, txt) {
  const el = document.getElementById(id);
  if (el) el.textContent = txt;
}

startApp();
