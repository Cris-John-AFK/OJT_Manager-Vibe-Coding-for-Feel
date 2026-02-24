import './style.css'
import {
  createIcons, Play, Square, Settings, X, Trash2, Download, LayoutDashboard, History, User, Pause, LogOut, Edit3, Check, Copy, Search, RefreshCw, FileSpreadsheet, UserMinus, Sun, Moon, CheckCircle, AlertCircle, TrendingUp, Calendar, Trophy
} from 'lucide';
import {
  initDatabase, getLogs, addLog, updateLog, getActiveSession,
  getSettings, updateSetting, getTotalRenderedHours, clearAllData,
  exportDatabase, pauseLog, resumeLog
} from './database';
import { setupAuthListeners, loginUser, registerUser, logoutUser, loginWithGoogle } from './auth';
import { db, auth } from './firebase';
import { doc, updateDoc, getDoc } from "firebase/firestore";
import { syncLocalDataToCloud, fetchStudentsByClassCode, getStudentData, kickStudentFromClass, createClass, fetchTeacherClasses } from './cloudSync';
import { LocalNotifications } from '@capacitor/local-notifications';
import { registerPlugin } from '@capacitor/core';
const Timer = registerPlugin('Timer');
// Global Error Handler for the user
window.onerror = function (msg, url, line) {
  console.error("Window Error:", msg, line);
  // Silent fail but logged
};

const ICON_LIB = { Play, Square, Settings, X, Trash2, Download, LayoutDashboard, History, User, Pause, LogOut, Edit3, Check, Copy, Search, RefreshCw, FileSpreadsheet, UserMinus, Sun, Moon, CheckCircle, AlertCircle, TrendingUp, Calendar };

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
let currentViewingStudentId = null;
let pendingConfirmAction = null;
let teacherClasses = [];
let currentTeacherClassCode = null;

let timerServiceStarted = false;

async function initMediaSession() {
  try {
    Timer.addListener('PAUSE', () => { handlePauseResume(); });
    Timer.addListener('TIMEOUT', () => { handleTimeOut(); });
  } catch (e) { console.log('Timer listener setup failed', e); }

  try {
    // Create the channel explicitly to match native ID and ensure visibility
    await LocalNotifications.createChannel({
      id: 'dtr_timer_channel',
      name: 'Active Session Timer',
      importance: 5,
      description: 'Shows active session timer with controls',
      visibility: 1
    });

    await LocalNotifications.registerActionTypes({
      types: [{
        id: 'SESSION_CONTROLS',
        actions: [
          { id: 'pause_action', title: 'Pause / Resume' },
          { id: 'timeout_action', title: 'Time Out', destructive: true }
        ]
      }]
    });
    LocalNotifications.addListener('localNotificationActionPerformed', (e) => {
      if (e.actionId === 'pause_action') handlePauseResume();
      if (e.actionId === 'timeout_action') handleTimeOut();
    });
  } catch (e) { console.log('LocalNotifications setup failed', e); }
}

async function startNativeTimer() {
  timerServiceStarted = false;
  // Initialize the native service
  await updateMediaNotification('00:00:00');
}

async function updateMediaNotification(time) {
  if (!window.Capacitor?.isNative) return;

  try {
    const active = getActiveSession();
    const isPaused = active && active.status === 'paused';

    if (!timerServiceStarted) {
      // Must match @PluginMethod name in Java
      await Timer.startNativeTimer({ time, isPaused });
      timerServiceStarted = true;
    } else {
      await Timer.updateTimer({ time, isPaused });
    }
  } catch (e) {
    alert('DTR Error: ' + e.message);
    console.error('Foreground Service failure:', e);
  }
}

async function startApp() {
  console.log("DTR App Initializing...");
  try {
    await initDatabase();
    console.log("Database initialized.");

    setupEventListeners();
    setupAuthUI();
    initTheme();
    updateAppUI();
    initMediaSession();

    // Fire a simple test notification immediately so we know if the system works
    if (window.Capacitor?.isNative) {
      setTimeout(async () => {
        try {
          const permResult = await LocalNotifications.checkPermissions();
          if (permResult.display !== 'granted') {
            const reqResult = await LocalNotifications.requestPermissions();
            showToast('Notif permission: ' + reqResult.display, reqResult.display === 'granted' ? 'success' : 'error');
          }
          await LocalNotifications.schedule({
            notifications: [{
              id: 1,
              title: '✅ DTR Manager Ready',
              body: 'Start a session and the timer will appear here!',
            }]
          });
        } catch (e) {
          showToast('Setup error: ' + (e.message || e), 'error');
        }
      }, 3000);
    }

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

  listen('logout-btn', () => {
    showConfirm({
      title: 'Confirm Logout',
      desc: 'Are you sure you want to log out of your account?',
      btnText: 'Logout',
      onConfirm: async () => {
        await logoutUser();
      }
    });
  });

  listen('confirm-cancel-btn', () => document.getElementById('confirm-modal')?.classList.add('hidden'));
  listen('confirm-action-btn', async () => {
    if (pendingConfirmAction) {
      const btn = document.getElementById('confirm-action-btn');
      btn.disabled = true;
      btn.textContent = 'Processing...';
      await pendingConfirmAction();
      btn.disabled = false;
      btn.textContent = 'Confirm';
      document.getElementById('confirm-modal')?.classList.add('hidden');
      pendingConfirmAction = null;
    }
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

  listen('join-class-btn', async () => {
    const code = document.getElementById('join-class-input')?.value.trim();
    if (!code) return;
    const user = auth.currentUser;
    if (user) {
      document.getElementById('join-class-btn').innerText = "...";
      await updateDoc(doc(db, "users", user.uid), { classCode: code });
      showToast("Successfully joined class " + code, "success");
      setTimeout(() => window.location.reload(), 1500);
    }
  });

  listen('leave-class-btn', async () => {
    const user = auth.currentUser;
    if (user) {
      showConfirm({
        title: 'Leave Class',
        desc: 'Are you sure you want to leave this class? Your teacher will no longer be able to track your progress.',
        btnText: 'Leave Class',
        onConfirm: async () => {
          await updateDoc(doc(db, "users", user.uid), { classCode: "" });
          window.location.reload();
        }
      });
    }
  });

  listen('copy-code-btn', () => {
    const code = document.getElementById('display-class-code')?.textContent;
    if (code) {
      navigator.clipboard.writeText(code);
      const btn = document.getElementById('copy-code-btn');
      if (btn) btn.innerHTML = '<i data-lucide="check" style="color:var(--success)"></i>';
      createIcons({ icons: ICON_LIB });
      setTimeout(() => {
        if (btn) btn.innerHTML = '<i data-lucide="copy"></i>';
        createIcons({ icons: ICON_LIB });
      }, 2000);
    }
  });

  listen('refresh-teacher-btn', () => {
    const user = auth.currentUser;
    if (user) {
      // Re-fetch user data to get latest classCode if needed, then reload
      window.location.reload();
    }
  });

  listen('export-class-btn', () => {
    exportClassReport();
  });

  listen('theme-toggle', () => {
    const isLight = document.body.classList.toggle('light-mode');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    updateThemeIcon();
  });

  listen('kick-student-btn', async () => {
    if (!currentViewingStudentId) return;
    showConfirm({
      title: 'Kick Student',
      desc: 'Are you sure you want to kick this student from your class? They will no longer appear in your list.',
      btnText: 'Kick Student',
      onConfirm: async () => {
        const res = await kickStudentFromClass(currentViewingStudentId);
        if (res.success) {
          document.getElementById('student-modal')?.classList.add('hidden');
          window.location.reload();
        } else {
          showToast("Failed to kick student: " + res.error, "error");
        }
      }
    });
  });

  const searchInput = document.getElementById('student-search');
  if (searchInput) {
    searchInput.oninput = (e) => {
      const term = e.target.value.toLowerCase();
      const cards = document.querySelectorAll('.student-card');
      cards.forEach(card => {
        const name = card.querySelector('.student-name')?.textContent.toLowerCase() || '';
        card.style.display = name.includes(term) ? 'flex' : 'none';
      });
    };
  }

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
    showConfirm({
      title: 'Erase Everything?',
      desc: 'This will permanently delete all your local logs and settings. This action cannot be undone.',
      btnText: 'Erase All Data',
      onConfirm: async () => {
        clearAllData();
      }
    });
  });

  listen('export-db', exportDatabase);

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    };
  });

  // Create Class Modal Listeners
  listen('close-create-class', () => {
    document.getElementById('create-class-modal')?.classList.add('hidden');
  });

  listen('confirm-create-class', async () => {
    const nameInput = document.getElementById('new-class-name');
    const name = nameInput.value;
    if (!name) return showToast("Please enter a class name", "error");

    const user = auth.currentUser;
    if (!user) return;

    const res = await createClass(user.uid, name);
    if (res.success) {
      showToast("Class created! Code: " + res.classCode, "success");
      document.getElementById('create-class-modal')?.classList.add('hidden');
      if (nameInput) nameInput.value = '';

      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) loadTeacherData({ uid: user.uid, ...snap.data() });
    } else {
      showToast(res.error, "error");
    }
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

    if (!res.success) showToast(res.error, "error");
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

    if (!res.success) showToast(res.error, "error");
    btn.textContent = oldText;
    btn.disabled = false;
  };

  // Google Handlers
  const handleGoogle = async () => {
    const res = await loginWithGoogle();
    if (!res.success) showToast(res.error, "error");
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
  if (isTeacher) {
    document.getElementById('teacher-section')?.classList.remove('hidden');
    document.getElementById('student-section')?.classList.add('hidden');
    loadTeacherData(userData);
  } else {
    document.getElementById('teacher-section')?.classList.add('hidden');
    document.getElementById('student-section')?.classList.remove('hidden');
    updateAppUI();
  }

  // Student settings setup
  document.getElementById('student-class-settings')?.classList.remove('hidden');
  const hasClass = !!userData.classCode;
  const noClassDiv = document.getElementById('no-class-view');
  const hasClassDiv = document.getElementById('has-class-view');

  if (hasClass) {
    noClassDiv?.classList.add('hidden');
    hasClassDiv?.classList.remove('hidden');
    setText('current-class-display', userData.classCode);
  } else {
    noClassDiv?.classList.remove('hidden');
    hasClassDiv?.classList.add('hidden');
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
  const teacherId = teacherData.uid;

  // 1. Fetch Classes
  teacherClasses = await fetchTeacherClasses(teacherId);

  // Create first class if none exist (backwards compatibility)
  if (teacherClasses.length === 0) {
    const defaultCode = teacherId.substring(0, 6).toUpperCase();
    const res = await createClass(teacherId, "My First Class");
    if (res.success) {
      teacherClasses = [{ code: res.classCode, name: "My First Class" }];
    }
  }

  // 2. Render Class Selector
  const selector = document.getElementById('class-selector');
  if (selector) {
    const activeCode = currentTeacherClassCode || teacherClasses[0].code;
    currentTeacherClassCode = activeCode;

    selector.innerHTML = teacherClasses.map(c => `
      <div class="class-pill ${c.code === activeCode ? 'active' : ''}" onclick="window.switchTeacherClass('${c.code}')">
        ${c.name}
      </div>
    `).join('') + '<button type="button" id="add-class-btn" class="class-pill add-class-btn">+ New Class</button>';

    // Re-bind add button since we just nuked innerHTML
    listen('add-class-btn', () => {
      document.getElementById('create-class-modal')?.classList.remove('hidden');
    });
  }

  // 3. Load Active Class Data
  setText('display-class-code', currentTeacherClassCode);
  const students = await fetchStudentsByClassCode(currentTeacherClassCode);

  setText('student-count', `${students.length} students joined`);

  const list = document.getElementById('students-list');
  if (!list) return;

  if (students.length === 0) {
    list.innerHTML = `<div class="empty-state">No students found for class ${currentTeacherClassCode}</div>`;
  } else {
    list.innerHTML = students.map(s => {
      const goal = s.goalHours || 600;
      const progress = (s.totalRendered / goal * 100).toFixed(1);
      return `
        <div class="student-card" onclick="window.viewStudentDetail('${s.id}')">
          <div class="student-info">
            <span class="student-name">${s.name}</span>
            <span class="student-progress">${s.totalRendered.toFixed(2)}h / ${goal}h</span>
          </div>
          <div class="progress-pct">${progress}%</div>
        </div>
      `;
    }).join('');
  }

  // 4. Analytics & Honor Roll Calculation
  const honorSection = document.getElementById('honor-roll-section');
  const honorList = document.getElementById('honor-roll-list');

  if (students.length > 0) {
    const totalHours = students.reduce((sum, s) => sum + s.totalRendered, 0);
    const avgHours = totalHours / students.length;
    const maxProgress = Math.max(...students.map(s => (s.totalRendered / (s.goalHours || 600) * 100)));

    setText('class-avg', `${avgHours.toFixed(1)}h`);
    setText('top-pct', `${maxProgress.toFixed(0)}%`);

    // Top 3 for Honor Roll
    const topStudents = [...students]
      .filter(s => s.totalRendered > 0)
      .sort((a, b) => b.totalRendered - a.totalRendered)
      .slice(0, 3);

    if (topStudents.length > 0 && honorSection && honorList) {
      honorSection.classList.remove('hidden');
      honorList.innerHTML = topStudents.map((s, i) => {
        const goal = s.goalHours || 600;
        const pct = (s.totalRendered / goal * 100).toFixed(0);
        return `
          <div class="honor-item">
            <div class="honor-rank">${i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</div>
            <div class="honor-name">${s.name}</div>
            <div class="honor-stats">
              <span class="honor-hours">${s.totalRendered.toFixed(1)}h</span>
              <span class="honor-pct">${pct}% Done</span>
            </div>
          </div>
        `;
      }).join('');
    } else {
      honorSection?.classList.add('hidden');
    }
  } else {
    setText('class-avg', '0h');
    setText('top-pct', '0%');
    honorSection?.classList.add('hidden');
  }

  // Refresh icons for dynamically injected content (like the trophy)
  createIcons();
}

window.switchTeacherClass = (code) => {
  currentTeacherClassCode = code;
  const user = auth.currentUser;
  if (user) {
    getDoc(doc(db, "users", user.uid)).then(snap => {
      if (snap.exists()) loadTeacherData({ uid: user.uid, ...snap.data() });
    });
  }
};

async function exportClassReport() {
  const code = document.getElementById('display-class-code')?.textContent;
  if (!code) return;

  const students = await fetchStudentsByClassCode(code);
  if (students.length === 0) {
    showToast("No students to export.", "error");
    return;
  }

  let csv = "Student Name,Email,Total Rendered,Goal,Progress %\n";
  students.forEach(s => {
    const goal = s.goalHours || 600;
    const progress = (s.totalRendered / goal * 100).toFixed(2);
    csv += `"${s.name}","${s.email}",${s.totalRendered.toFixed(2)},${goal},${progress}%\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `OJT_Class_Report_${code}.csv`;
  a.click();
}

window.viewStudentDetail = async (studentId) => {
  currentViewingStudentId = studentId;
  const student = await getStudentData(studentId);
  if (!student) return;

  setText('modal-student-name', `${student.name}'s Progress`);
  setText('modal-student-rendered', `${(student.totalRendered || 0).toFixed(2)}h (${((student.totalRendered || 0) / (student.goalHours || 600) * 100).toFixed(1)}%)`);
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
    setText('rendered-percent', `${progress.toFixed(1)}%`);
    const bar = document.getElementById('progress-bar');
    if (bar) bar.style.strokeDashoffset = 283 - (283 * progress) / 100;

    const logs = getLogs();
    // Analytics Calculation
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const weekLogs = logs.filter(l => new Date(l.date) >= sevenDaysAgo);
    const weekTotal = weekLogs.reduce((sum, l) => sum + (parseFloat(l.duration) || 0), 0);
    const avgSession = logs.length > 0 ? (completedHours / logs.length) : 0;

    setText('avg-session', `${avgSession.toFixed(2)}h`);
    setText('week-total', `${weekTotal.toFixed(2)}h`);

    // Render Recent Logs
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

  // Start the native foreground service notification
  startNativeTimer();

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

  try {
    Timer.stopTimer();
  } catch (e) { }

  updateAppUI();
  syncCloud(); // Sync after timeout
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

    // Update top level stats every second too!
    updateStatsOnly(active);

    // Update System Notification
    updateMediaNotification(`${h}:${m}:${s}`);
  }, 1000);
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
  timerServiceStarted = false;

  try { Timer.stopTimer(); } catch (e) { }
  try { LocalNotifications.cancel({ notifications: [{ id: 9001 }] }); } catch (e) { }
}

function setText(id, txt) {
  const el = document.getElementById(id);
  if (el) el.textContent = txt;
}

function showConfirm({ title, desc, btnText, onConfirm }) {
  setText('confirm-title', title);
  setText('confirm-description', desc);
  const actionBtn = document.getElementById('confirm-action-btn');
  if (actionBtn) actionBtn.textContent = btnText || 'Confirm';

  pendingConfirmAction = onConfirm;
  document.getElementById('confirm-modal')?.classList.remove('hidden');
}

function showToast(message, type = "success") {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icon = type === "success" ? "check-circle" : "alert-circle";
  toast.innerHTML = `
    <i data-lucide="${icon}"></i>
    <span>${message}</span>
  `;

  container.appendChild(toast);
  createIcons({ icons: ICON_LIB });

  // Slide up and fade in are handled by CSS animation

  setTimeout(() => {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'light') {
    document.body.classList.add('light-mode');
  }
  updateThemeIcon();
}

function updateThemeIcon() {
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    const isLight = document.body.classList.contains('light-mode');
    btn.innerHTML = `<i data-lucide="${isLight ? 'sun' : 'moon'}"></i>`;
    createIcons({ icons: ICON_LIB });
  }
}

startApp();
