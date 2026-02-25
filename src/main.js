import './style.css'
import {
  createIcons, Play, Square, Settings, X, Trash2, Download, LayoutDashboard, History, User, Pause, LogOut, Edit3, Check, Copy, Search, RefreshCw, FileSpreadsheet, UserMinus, Sun, Moon, CheckCircle, AlertCircle, TrendingUp, Calendar, Trophy, BookOpen, Plus, ArrowLeft, RotateCcw
} from 'lucide';
import {
  initDatabase, getLogs, addLog, updateLog, getActiveSession,
  getSettings, updateSetting, getTotalRenderedHours, clearAllData,
  exportDatabase, pauseLog, resumeLog, insertManualLog,
  getArchivedLogs, archiveLog, recoverLog, permanentlyDeleteLog, cleanupOldArchivedLogs
} from './database';
import { setupAuthListeners, loginUser, registerUser, logoutUser, loginWithGoogle } from './auth';
import { db, auth } from './firebase';
import { doc, updateDoc, getDoc } from "firebase/firestore";
import { syncLocalDataToCloud, fetchStudentsByClassCode, getStudentData, kickStudentFromClass, createClass, fetchTeacherClasses } from './cloudSync';
import { LocalNotifications } from '@capacitor/local-notifications';
import { registerPlugin } from '@capacitor/core';

const Timer = registerPlugin('Timer');

const ICON_LIB = {
  Play, Square, Settings, X, Trash2, Download, LayoutDashboard, History, User, Pause, LogOut,
  Edit3, Check, Copy, Search, RefreshCw, FileSpreadsheet, UserMinus, Sun, Moon, CheckCircle,
  AlertCircle, TrendingUp, Calendar, BookOpen, Plus, ArrowLeft, RotateCcw
};

const listen = (id, fn) => {
  const el = document.getElementById(id);
  if (el) el.onclick = (e) => fn(e);
};

// Global State
let timerInterval = null;
let currentViewingStudentId = null;
let pendingConfirmAction = null;
let teacherClasses = [];
let currentTeacherClassCode = null;
let timerServiceStarted = false;

async function startApp() {
  console.log("DTR App Initializing...");
  try {
    await initDatabase();
    cleanupOldArchivedLogs();
    setupEventListeners();
    setupAuthUI();
    initTheme();
    setupViewNavigation();
    updateAppUI();
    initMediaSession();

    setupAuthListeners(handleAuthLogin, handleAuthLogout);

    const splash = document.getElementById('splash-screen');
    setTimeout(() => {
      if (splash) splash.style.opacity = '0';
      setTimeout(() => splash?.classList.add('hidden'), 800);
    }, 1500);

  } catch (error) { console.error("App Crash:", error); }
}

function setupViewNavigation() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.onclick = () => {
      const viewId = tab.getAttribute('data-view');
      switchView(viewId);
    };
  });
}

function switchView(viewId) {
  document.querySelectorAll('.app-view').forEach(v => v.classList.add('hidden'));

  const target = document.getElementById('view-' + viewId) || document.getElementById(viewId);
  if (target) {
    target.classList.remove('hidden');
    document.getElementById('main-content').scrollTop = 0;
  }

  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.toggle('active', t.getAttribute('data-view') === viewId);
  });

  const titles = {
    'home': 'Dashboard',
    'journal': 'Journal',
    'settings': 'Settings',
    'teacher-section': 'Class Management',
    'view-archive': 'Archive'
  };
  setText('view-title', titles[viewId] || 'DTR Manager');

  if (viewId === 'journal') renderJournalLogs();
  if (viewId === 'view-archive') renderArchivedLogs();
  if (viewId === 'home') updateAppUI();

  createIcons({ icons: ICON_LIB });
}

function setupEventListeners() {
  listen('time-in-btn', handleTimeIn);
  listen('time-out-btn', () => document.getElementById('timeout-modal')?.classList.remove('hidden'));
  listen('pause-btn', handlePauseResume);

  listen('logout-btn', () => {
    showConfirm({
      title: 'Sign Out',
      desc: 'Are you sure you want to end your session and sign out?',
      btnText: 'Sign Out',
      onConfirm: async () => await logoutUser()
    });
  });

  listen('confirm-cancel-btn', () => document.getElementById('confirm-modal')?.classList.add('hidden'));
  listen('confirm-action-btn', async () => {
    if (pendingConfirmAction) {
      const btn = document.getElementById('confirm-action-btn');
      btn.innerText = 'Working...';
      await pendingConfirmAction();
      document.getElementById('confirm-modal')?.classList.add('hidden');
      pendingConfirmAction = null;
    }
  });

  listen('save-settings', () => {
    const input = document.getElementById('goal-hours-input');
    const val = input?.value;
    if (val && !isNaN(val)) {
      updateSetting('goal_hours', val);
      showToast('OJT Goal updated!', 'success');
      updateAppUI();
    }
  });

  listen('close-timeout', () => document.getElementById('timeout-modal')?.classList.add('hidden'));
  listen('confirm-timeout-btn', confirmTimeOut);

  listen('manual-entry-btn', () => document.getElementById('manual-form-container')?.classList.remove('hidden'));
  listen('close-manual', () => document.getElementById('manual-form-container')?.classList.add('hidden'));
  listen('save-manual-btn', handleSaveManual);
  listen('download-journal-btn', downloadJournal);

  listen('join-class-btn', async () => {
    const code = document.getElementById('join-class-input')?.value.trim();
    if (!code) return showToast('Please enter a class code', 'error');
    const user = auth.currentUser;
    if (user) {
      await updateDoc(doc(db, "users", user.uid), { classCode: code });
      showToast("Joined: " + code, "success");
      setTimeout(() => window.location.reload(), 1000);
    }
  });

  listen('leave-class-btn', async () => {
    showConfirm({
      title: 'Leave Class',
      desc: 'You will no longer be visible to your teacher.',
      btnText: 'Leave',
      onConfirm: async () => {
        const user = auth.currentUser;
        if (user) {
          await updateDoc(doc(db, "users", user.uid), { classCode: "" });
          window.location.reload();
        }
      }
    });
  });

  listen('copy-code-btn', () => {
    const code = document.getElementById('display-class-code')?.textContent;
    if (code) {
      navigator.clipboard.writeText(code);
      showToast('Class code copied!', 'success');
    }
  });

  listen('theme-toggle', () => {
    const isLight = document.body.classList.toggle('light-mode');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    updateThemeIcon();
  });

  listen('view-all-btn', () => switchView('view-history'));
  listen('close-history', () => switchView('journal'));

  listen('view-archive-btn', () => switchView('view-archive'));
  listen('close-archive', () => switchView('settings'));

  // Teacher side
  listen('refresh-teacher-btn', () => window.location.reload());
  listen('export-class-btn', () => exportClassReport());
  listen('close-student-modal', () => switchView('teacher-section'));
  listen('kick-student-btn', async () => {
    if (!currentViewingStudentId) return;
    showConfirm({
      title: 'Remove Student',
      desc: 'Kick this student from your class?',
      btnText: 'Remove',
      onConfirm: async () => {
        await kickStudentFromClass(currentViewingStudentId);
        window.location.reload();
      }
    });
  });

  const searchInput = document.getElementById('student-search');
  if (searchInput) {
    searchInput.oninput = (e) => {
      const term = e.target.value.toLowerCase();
      document.querySelectorAll('.student-card').forEach(card => {
        const name = card.querySelector('.s-name')?.textContent.toLowerCase() || '';
        card.style.display = name.includes(term) ? 'flex' : 'none';
      });
    };
  }

  listen('close-create-class', () => document.getElementById('create-class-modal')?.classList.add('hidden'));
  listen('confirm-create-class', async () => {
    const name = document.getElementById('new-class-name')?.value;
    if (!name) return showToast("Enter a class name", "error");
    const res = await createClass(auth.currentUser.uid, name);
    if (res.success) {
      showToast("Class created!", "success");
      window.location.reload();
    }
  });
}

function updateAppUI() {
  try {
    const settings = getSettings();
    const goal = parseFloat(settings.goal_hours || 600);
    const active = getActiveSession();
    let completedHours = getTotalRenderedHours();
    let currentSessionHours = 0;

    if (active) {
      const start = new Date(active.iso_start).getTime();
      const pastPaused = parseInt(active.total_paused_ms) || 0;
      const endMarker = active.status === 'paused' ? new Date(active.paused_at).getTime() : Date.now();
      currentSessionHours = Math.max(0, (endMarker - start - pastPaused) / (1000 * 60 * 60));
    }

    const totalDone = completedHours + currentSessionHours;
    setText('rendered-hours', `${totalDone.toFixed(2)}h`);
    setText('goal-hours-display', `${goal}h`);
    setText('remaining-hours', `${Math.max(0, goal - totalDone).toFixed(2)}h`);
    setText('current-date', new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }));

    const progress = goal > 0 ? Math.min(100, (totalDone / goal) * 100) : 0;
    setText('rendered-percent', `${progress.toFixed(1)}%`);
    const bar = document.getElementById('progress-bar');
    if (bar) bar.style.strokeDashoffset = 283 - (283 * progress) / 100;

    const logs = getLogs();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const weekTotal = logs.filter(l => new Date(l.date) >= sevenDaysAgo).reduce((s, l) => s + (parseFloat(l.duration) || 0), 0);
    const avgSession = logs.length > 0 ? (completedHours / logs.length) : 0;
    setText('avg-session', `${avgSession.toFixed(2)}h`);
    setText('week-total', `${weekTotal.toFixed(2)}h`);

    const card = document.getElementById('active-session-card');
    const stoppedActions = document.getElementById('stopped-actions');
    const startedActions = document.getElementById('started-actions');
    const pauseBtn = document.getElementById('pause-btn');

    if (active) {
      card?.classList.remove('hidden');
      stoppedActions?.classList.add('hidden');
      startedActions?.classList.remove('hidden');
      if (active.status === 'paused') {
        pauseBtn.innerHTML = '<i data-lucide="play"></i><span>RESUME</span>';
        stopSessionTimer();
      } else {
        pauseBtn.innerHTML = '<i data-lucide="pause"></i><span>PAUSE</span>';
        runSessionTimer(active);
      }
    } else {
      card?.classList.add('hidden');
      stoppedActions?.classList.remove('hidden');
      startedActions?.classList.add('hidden');
      stopSessionTimer();
    }
    createIcons({ icons: ICON_LIB });
  } catch (e) { console.error("UI Update Failed", e); }
}

function renderJournalLogs() {
  const logs = getLogs();
  const list = document.getElementById('logs-list');
  const histList = document.getElementById('history-logs-list');

  const generateHtml = (l) => `
      <div class="log-item">
        <div class="log-date-info">
          <span class="l-date">${l.date}</span>
          <span class="l-time">${l.time_in} - ${l.time_out}</span>
        </div>
        <div class="log-duration">${parseFloat(l.duration).toFixed(2)}h</div>
        ${l.notes ? `<div class="log-notes">${l.notes}</div>` : ''}
        <div class="log-actions-native">
           <button class="action-icon-btn danger" onclick="window.handleArchive(${l.id})">
             <i data-lucide="trash-2"></i> Archive
           </button>
        </div>
      </div>
    `;

  const html = logs.length === 0 ? '<div class="empty-state">No logs recorded.</div>' : logs.map(generateHtml).join('');
  if (list) list.innerHTML = html;
  if (histList) histList.innerHTML = html;
  createIcons({ icons: ICON_LIB });
}

window.handleArchive = (id) => {
  showConfirm({
    title: 'Move to Archive?',
    desc: 'Log will be removed from journal but can be recovered from the Archive for 30 days.',
    btnText: 'Archive',
    onConfirm: () => {
      archiveLog(id);
      showToast('Log moved to Archive', 'success');
      renderJournalLogs();
      updateAppUI();
    }
  });
};

function renderArchivedLogs() {
  const logs = getArchivedLogs();
  const list = document.getElementById('archive-logs-list');
  if (!list) return;
  list.innerHTML = logs.length === 0 ? '<div class="empty-state">Archive is empty.</div>' :
    logs.map(l => `
      <div class="log-item">
        <div class="log-date-info">
          <span class="l-date">${l.date}</span>
          <span class="l-time">${l.time_in} - ${l.time_out}</span>
        </div>
        <div class="log-duration">${parseFloat(l.duration).toFixed(2)}h</div>
        <div class="log-actions-native">
           <button class="action-icon-btn recover" onclick="window.handleRecover(${l.id})">
             <i data-lucide="rotate-ccw"></i> Recover
           </button>
           <button class="action-icon-btn danger" onclick="window.handlePermDelete(${l.id})">
             <i data-lucide="trash-2"></i> Delete
           </button>
        </div>
      </div>
    `).join('');
  createIcons({ icons: ICON_LIB });
}

window.handleRecover = (id) => {
  recoverLog(id);
  showToast('Log recovered', 'success');
  renderArchivedLogs();
  updateAppUI();
};

window.handlePermDelete = (id) => {
  showConfirm({
    title: 'Delete Forever?',
    desc: 'This cannot be undone.',
    btnText: 'Delete',
    onConfirm: () => {
      permanentlyDeleteLog(id);
      showToast('Log deleted forever', 'error');
      renderArchivedLogs();
    }
  });
};

async function handleSaveManual() {
  const dateStr = document.getElementById('manual-date').value;
  const timeInStr = document.getElementById('manual-time-in').value;
  const timeOutStr = document.getElementById('manual-time-out').value;
  const notes = document.getElementById('manual-notes').value;
  if (!dateStr || !timeInStr || !timeOutStr) return showToast('Fill in all time fields!', 'error');
  const start = new Date(`${dateStr}T${timeInStr}`);
  let end = new Date(`${dateStr}T${timeOutStr}`);
  if (end < start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  const durationHours = (end - start) / (1000 * 60 * 60);
  if (durationHours <= 0) return showToast('Check your times!', 'error');
  const res = insertManualLog({
    date: dateStr, timeIn: formatAMPM(timeInStr), timeOut: formatAMPM(timeOutStr),
    duration: durationHours, notes: notes || "Manual entry"
  });
  if (res) {
    showToast('Entry saved!', 'success');
    document.getElementById('manual-form-container').classList.add('hidden');
    document.getElementById('manual-date').value = '';
    document.getElementById('manual-time-in').value = '';
    document.getElementById('manual-time-out').value = '';
    document.getElementById('manual-notes').value = '';
    updateAppUI(); renderJournalLogs(); syncLocalDataToCloud();
  }
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerText = msg;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 500); }, 3500);
}

function showConfirm({ title, desc, btnText, onConfirm }) {
  document.getElementById('confirm-title').innerText = title;
  document.getElementById('confirm-description').innerText = desc;
  const actionBtn = document.getElementById('confirm-action-btn');
  actionBtn.innerText = btnText;
  pendingConfirmAction = onConfirm;
  document.getElementById('confirm-modal').classList.remove('hidden');
}

function setupAuthUI() {
  const toSignup = document.getElementById('to-signup');
  const toLogin = document.getElementById('to-login');
  const lForm = document.getElementById('login-form');
  const sForm = document.getElementById('signup-form');
  if (toSignup) toSignup.onclick = (e) => { e.preventDefault(); lForm.classList.add('hidden'); sForm.classList.remove('hidden'); setText('auth-subtitle', 'Create a new account'); };
  if (toLogin) toLogin.onclick = (e) => { e.preventDefault(); sForm.classList.add('hidden'); lForm.classList.remove('hidden'); setText('auth-subtitle', 'Sign in to continue'); };
  if (lForm) lForm.onsubmit = async (e) => {
    e.preventDefault();
    const btn = lForm.querySelector('button'); btn.innerText = 'Authenticating...'; btn.disabled = true;
    const res = await loginUser(document.getElementById('login-email').value, document.getElementById('login-password').value);
    if (!res.success) { showToast(res.error, "error"); btn.innerText = 'Sign In'; btn.disabled = false; }
  };
  if (sForm) sForm.onsubmit = async (e) => {
    e.preventDefault();
    const btn = sForm.querySelector('button'); btn.innerText = 'Creating account...'; btn.disabled = true;
    const res = await registerUser(
      document.getElementById('signup-name').value, document.getElementById('signup-email').value,
      document.getElementById('signup-password').value, sForm.querySelector('input[name="role"]:checked').value,
      document.getElementById('signup-class-code').value
    );
    if (!res.success) { showToast(res.error, "error"); btn.innerText = 'Create Account'; btn.disabled = false; }
  };
  listen('google-login-btn', loginWithGoogle);
  listen('save-setup-btn', async () => {
    const role = document.querySelector('input[name="setup-role"]:checked').value;
    const code = document.getElementById('setup-class-code').value;
    await updateDoc(doc(db, "users", auth.currentUser.uid), { role, classCode: code });
    window.location.reload();
  });
}

function setText(id, txt) { const el = document.getElementById(id); if (el) el.innerText = txt; }
function formatAMPM(t) { let [h, m] = t.split(':'); let hrs = parseInt(h); const ampm = hrs >= 12 ? 'PM' : 'AM'; hrs = hrs % 12 || 12; return `${hrs}:${m} ${ampm}`; }

function runSessionTimer(active) {
  if (timerInterval) clearInterval(timerInterval);
  const start = new Date(active.iso_start).getTime();
  const pastPaused = parseInt(active.total_paused_ms) || 0;
  timerInterval = setInterval(() => {
    const diff = Date.now() - start - pastPaused;
    const timeStr = formatMs(diff);
    setText('session-timer', timeStr);
    updateMediaNotification(timeStr);
  }, 1000);
}

function stopSessionTimer() { if (timerInterval) clearInterval(timerInterval); timerInterval = null; }
function formatMs(ms) {
  let s = Math.floor(ms / 1000); let m = Math.floor(s / 60); let h = Math.floor(m / 60);
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function handleTimeIn() {
  const now = new Date();
  addLog(now.toLocaleDateString(), now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), now.toISOString());
  startNativeTimer(); updateAppUI(); showToast('Time In recorded!', 'success');
}

function handlePauseResume() {
  const active = getActiveSession();
  if (active.status === 'paused') resumeLog(active.id, new Date().toISOString()); else pauseLog(active.id, new Date().toISOString());
  updateAppUI();
}

async function confirmTimeOut() {
  const active = getActiveSession(); if (!active) return;
  const notes = document.getElementById('log-notes-input')?.value || '';
  const start = new Date(active.iso_start).getTime();
  const pastPaused = parseInt(active.total_paused_ms) || 0;
  const duration = (Date.now() - start - pastPaused) / (1000 * 60 * 60);
  updateLog(active.id, {
    time_out: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    status: 'completed', notes: notes, duration: duration
  });
  if (window.Capacitor?.isNative) await Timer.stopNativeTimer();
  document.getElementById('timeout-modal').classList.add('hidden');
  document.getElementById('log-notes-input').value = '';
  updateAppUI(); renderJournalLogs(); syncCloud(); showToast('Session saved', 'success');
}

async function downloadJournal() {
  const logs = getLogs();
  if (logs.length === 0) return showToast('No logs to export', 'error');

  const userName = document.getElementById('user-display-name')?.innerText || 'User';
  const total = getTotalRenderedHours();
  const goal = getSettings().goal_hours || 600;

  let html = `
    <html>
    <head><meta charset="utf-8"><style>
      table { border-collapse: collapse; width: 100%; font-family: sans-serif; }
      th, td { border: 1px solid #000; padding: 8px; text-align: left; }
      th { background-color: #f2f2f2; }
      .header { margin-bottom: 20px; }
    </style></head>
    <body>
      <div class="header">
        <h2>OJT Daily Time Record</h2>
        <p><b>Student:</b> ${userName}</p>
        <p><b>Total Rendered:</b> ${total.toFixed(2)}h / ${goal}h</p>
        <p><b>Export Date:</b> ${new Date().toLocaleDateString()}</p>
      </div>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Time In</th>
            <th>Time Out</th>
            <th>Duration (h)</th>
            <th>Activities / Notes</th>
          </tr>
        </thead>
        <tbody>
          ${logs.map(l => `
            <tr>
              <td>${l.date}</td>
              <td>${l.time_in}</td>
              <td>${l.time_out}</td>
              <td>${parseFloat(l.duration).toFixed(2)}</td>
              <td>${l.notes || ''}</td>
            </tr>
          `).join('')}
          <tr style="font-weight:bold; background:#eee;">
            <td colspan="3">TOTAL HOURS</td>
            <td>${total.toFixed(2)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </body>
    </html>
  `;

  const blob = new Blob([html], { type: 'application/msword' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `OJT_Journal_${userName}_${new Date().toISOString().split('T')[0]}.doc`;
  a.click();
  showToast('Journal exported as Word doc', 'success');
}

function handleAuthLogin(userData) {
  if (!userData.role) { document.getElementById('google-setup-modal').classList.remove('hidden'); return; }
  document.getElementById('auth-container').classList.add('hidden');
  document.getElementById('root').classList.remove('hidden');
  if (userData.role === 'teacher') { switchView('teacher-section'); loadTeacherData(userData); }
  else { switchView('home'); updateAppUI(); }
  setText('user-display-name', userData.displayName || userData.name || 'User');
  setText('user-role-badge', userData.role);
}

function handleAuthLogout() { document.getElementById('root').classList.add('hidden'); document.getElementById('auth-container').classList.remove('hidden'); }

function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'light') document.body.classList.add('light-mode');
  updateThemeIcon();
}

function updateThemeIcon() {
  const icon = document.querySelector('#theme-toggle i');
  if (icon) { icon.setAttribute('data-lucide', document.body.classList.contains('light-mode') ? 'sun' : 'moon'); createIcons({ icons: ICON_LIB }); }
}

async function updateMediaNotification(time) {
  if (!window.Capacitor?.isNative) return;
  const active = getActiveSession(); const isPaused = active?.status === 'paused';
  if (!timerServiceStarted) { await Timer.startNativeTimer({ time, isPaused }); timerServiceStarted = true; }
  else { await Timer.updateTimer({ time, isPaused }); }
}

async function initMediaSession() {
  try { Timer.addListener('PAUSE', handlePauseResume); Timer.addListener('TIMEOUT', () => document.getElementById('timeout-modal').classList.remove('hidden')); } catch (e) { }
}

async function exportClassReport() {
  const code = document.getElementById('display-class-code')?.textContent;
  if (!code) return;
  const students = await fetchStudentsByClassCode(code);
  let csv = "Name,Rendered,Goal\n";
  students.forEach(s => csv += `"${s.name}",${s.totalRendered.toFixed(2)},${s.goalHours || 600}\n`);
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `Class_Report_${code}.csv`; a.click();
}

async function loadTeacherData(teacherData) {
  teacherClasses = await fetchTeacherClasses(teacherData.uid);
  if (teacherClasses.length === 0) {
    const res = await createClass(teacherData.uid, "My Class");
    if (res.success) teacherClasses = [{ code: res.classCode, name: "My Class" }];
  }
  currentTeacherClassCode = currentTeacherClassCode || teacherClasses[0].code;
  const selector = document.getElementById('class-selector');
  selector.innerHTML = teacherClasses.map(c => `<div class="pill-tab ${c.code === currentTeacherClassCode ? 'active' : ''}" onclick="window.switchTeacherClass('${c.code}')">${c.name}</div>`).join('') + '<button id="add-class-btn" class="pill-tab">+ New</button>';
  listen('add-class-btn', () => document.getElementById('create-class-modal').classList.remove('hidden'));
  setText('display-class-code', currentTeacherClassCode);
  const students = await fetchStudentsByClassCode(currentTeacherClassCode);
  const list = document.getElementById('students-list');
  list.innerHTML = students.length === 0 ? '<div class="empty-state">No students joined yet.</div>' :
    students.map(s => `
      <div class="student-card" onclick="window.viewStudentDetail('${s.id}')">
        <div class="s-info"><span class="s-name">${s.name}</span><br><span class="s-prog">${s.totalRendered.toFixed(1)}h / ${s.goalHours || 600}h</span></div>
        <div class="s-stat">${((s.totalRendered / (s.goalHours || 600)) * 100).toFixed(0)}%</div>
      </div>
    `).join('');
  if (students.length > 0) {
    const avg = students.reduce((a, b) => a + b.totalRendered, 0) / students.length;
    setText('class-avg', avg.toFixed(1) + 'h'); setText('top-pct', Math.max(...students.map(s => (s.totalRendered / (s.goalHours || 600)) * 100)).toFixed(0) + '%');
  }
}

window.switchTeacherClass = (code) => { currentTeacherClassCode = code; loadTeacherData({ uid: auth.currentUser.uid }); };

window.viewStudentDetail = async (id) => {
  currentViewingStudentId = id; const s = await getStudentData(id);
  setText('modal-student-name', s.name); setText('modal-student-rendered', s.totalRendered.toFixed(1) + 'h'); setText('modal-student-goal', (s.goalHours || 600) + 'h');
  const list = document.getElementById('modal-student-logs');
  list.innerHTML = s.logs.map(l => `<div class="log-item">
      <div class="log-date-info"><b>${l.date}</b><br>${l.time_in} - ${l.time_out}</div>
      <div class="log-duration">${parseFloat(l.duration).toFixed(1)}h</div>
    </div>`).join('');
  switchView('student-detail-view');
};

async function syncCloud() {
  const logs = getLogs(); const settings = getSettings(); await syncLocalDataToCloud(logs, settings);
}

async function startNativeTimer() {
  timerServiceStarted = false; await updateMediaNotification('00:00:00');
}

startApp();
