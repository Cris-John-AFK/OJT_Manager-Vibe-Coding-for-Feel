import './style.css'
import {
  createIcons, Play, Square, Settings, X, Trash2, Download, LayoutDashboard, History, User, Pause, LogOut, Edit3, Check, Copy, Search, RefreshCw, FileSpreadsheet, UserMinus, Sun, Moon, CheckCircle, CheckCheck, AlertCircle, TrendingUp, Calendar, Trophy, BookOpen, Plus, ArrowLeft, RotateCcw, CloudOff, Image, ImageOff, MapPinOff, MapPin
} from 'lucide';
import {
  initDatabase, getLogs, addLog, updateLog, getActiveSession,
  getSettings, updateSetting, getTotalRenderedHours, clearAllData,
  exportDatabase, pauseLog, resumeLog, insertManualLog, saveDatabase,
  getArchivedLogs, archiveLog, recoverLog, permanentlyDeleteLog, cleanupOldArchivedLogs
} from './database';
import { setupAuthListeners, loginUser, registerUser, logoutUser, loginWithGoogle } from './auth';
import { db, auth, storage } from './firebase';
import { doc, updateDoc, getDoc } from "firebase/firestore";
import { ref, uploadString, getDownloadURL } from "firebase/storage";
import { syncLocalDataToCloud, fetchStudentsByClassCode, getStudentData, kickStudentFromClass, createClass, fetchTeacherClasses } from './cloudSync';
import { LocalNotifications } from '@capacitor/local-notifications';
import { registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Geolocation } from '@capacitor/geolocation';



const Timer = registerPlugin('Timer');

const ICON_LIB = {
  Play, Square, Settings, X, Trash2, Download, LayoutDashboard, History, User, Pause, LogOut,
  Edit3, Check, Copy, Search, RefreshCw, FileSpreadsheet, UserMinus, Sun, Moon, CheckCircle, CheckCheck,
  AlertCircle, TrendingUp, Calendar, BookOpen, Plus, ArrowLeft, RotateCcw, CloudOff, Image, ImageOff, MapPinOff, MapPin
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
let cachedTimeoutLocation = null; // stores GPS for the current timeout session
let timerServiceStarted = false;

async function startApp() {
  console.log("DTR App Initializing...");
  try {
    const database = await initDatabase();
    if (!database) {
      console.warn("Database failed to init, retrying in 2s...");
      setTimeout(() => initDatabase().then(updateAppUI), 2000);
    }

    cleanupOldArchivedLogs();
    setupEventListeners();
    setupAuthUI();
    initTheme();
    initTheme();
    updateAppUI();
    initMediaSession();

    setupAuthListeners(handleAuthLogin, handleAuthLogout);

    // Set explicit persistence to ensure login stays across restarts
    const { setPersistence, browserLocalPersistence } = await import("firebase/auth");
    await setPersistence(auth, browserLocalPersistence);

    // Initial Sync after database is ready
    setTimeout(() => syncCloud(), 3000);

    // Auto-save interval (every 5 minutes) as fallback
    setInterval(() => saveDatabase(), 5 * 60 * 1000);

    // Connectivity Listeners
    window.addEventListener('online', () => {
      showToast("You're back online! Syncing data...", "info");
      syncCloud();
    });
    window.addEventListener('offline', () => {
      showToast("No internet connection. Using local storage.", "warning");
      updateSyncIndicator('offline');
    });

    // Handle Deep Links for Auth redirect
    App.addListener('appUrlOpen', async ({ url }) => {
      console.log('App opened with URL:', url);
      if (url.includes('com.crisjohn.dtrmanager')) {
        // Force the app to check for redirect result
        await Browser.close();
      }
    });


    const splash = document.getElementById('splash-screen');
    setTimeout(() => {
      if (splash) splash.style.opacity = '0';
      setTimeout(() => splash?.classList.add('hidden'), 800);
    }, 1500);

  } catch (error) { console.error("App Crash:", error); }
}

function updateSyncIndicator(state) {
  const badge = document.getElementById('sync-badge');
  const text = document.getElementById('sync-text');
  const icon = document.getElementById('sync-icon');
  if (!badge || !text || !icon) return;

  badge.classList.remove('offline', 'syncing');

  if (state === 'offline') {
    badge.classList.add('offline');
    text.innerText = 'Offline';
    icon.setAttribute('data-lucide', 'cloud-off');
  } else if (state === 'syncing') {
    badge.classList.add('syncing');
    text.innerText = 'Syncing...';
    icon.setAttribute('data-lucide', 'refresh-cw');
  } else {
    text.innerText = 'Cloud Synced';
    icon.setAttribute('data-lucide', 'check-circle');
  }
  createIcons({ icons: { ...ICON_LIB, CloudOff: ICON_LIB.CloudOff || ICON_LIB.AlertCircle } });
}




function setupViewNavigation() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    // Hide the journal tab specifically if logged in as teacher
    if (tab.getAttribute('data-view') === 'journal' && window.currentUserRole === 'teacher') {
      tab.style.display = 'none';
    }

    tab.onclick = () => {
      const viewId = tab.getAttribute('data-view');
      switchView(viewId);
    };
  });
}

function switchView(viewId) {
  if (viewId === 'home' && window.currentUserRole === 'teacher') {
    viewId = 'teacher-section';
  }

  document.querySelectorAll('.app-view').forEach(v => v.classList.add('hidden'));

  const target = document.getElementById('view-' + viewId) || document.getElementById(viewId);
  if (target) {
    target.classList.remove('hidden');
    document.getElementById('main-content').scrollTop = 0;
  }

  document.querySelectorAll('.nav-tab').forEach(t => {
    // Keep the first tab ("Dashboard") highlighted even if we visually switched to "teacher-section"
    t.classList.toggle('active', t.getAttribute('data-view') === viewId || (viewId === 'teacher-section' && t.getAttribute('data-view') === 'home'));
  });

  const titles = {
    'home': 'Dashboard',
    'journal': 'Journal',
    'settings': 'Settings',
    'teacher-section': 'Class Management',
    'view-archive': 'Archive'
  };
  setText('view-title', titles[viewId] || 'DTR Manager');

  if (viewId === 'journal') {
    const picker = document.getElementById('month-filter');
    if (picker && !picker.value) {
      const now = new Date();
      picker.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    renderJournalLogs();
  }
  if (viewId === 'view-history') renderHistoryLogs();
  if (viewId === 'view-archive') renderArchivedLogs();


  createIcons({ icons: ICON_LIB });
}

function setupEventListeners() {
  listen('time-in-btn', handleTimeIn);
  listen('time-out-btn', () => {
    document.getElementById('timeout-modal')?.classList.remove('hidden');
    // Immediately start grabbing location when modal opens
    refreshTimeoutLocation();
  });
  listen('pause-btn', handlePauseResume);
  listen('refresh-location-btn', refreshTimeoutLocation);

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

  const monthPicker = document.getElementById('month-filter');
  if (monthPicker) monthPicker.oninput = () => renderJournalLogs();

  listen('clear-filter-btn', () => {
    const picker = document.getElementById('month-filter');
    if (picker) picker.value = '';
    renderJournalLogs();
  });


  listen('view-archive-btn', () => switchView('view-archive'));
  listen('close-archive', () => switchView('settings'));
  listen('close-edit', () => document.getElementById('edit-modal').classList.add('hidden'));
  listen('update-log-btn', handleUpdateLog_Unified);


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
  const monthFilter = document.getElementById('month-filter')?.value; // YYYY-MM
  const logs = getLogs(monthFilter);
  const list = document.getElementById('logs-list');

  const generateHtml = (l) => `
      <div class="log-item">
        <div class="log-date-info">
          <span class="l-date">${l.date}</span>
          <span class="l-time">${l.time_in} - ${l.time_out}</span>
          ${l.location_in ? `<br><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.location_in)}" target="_blank" style="color:var(--text-secondary);font-size:0.75rem;display:inline-flex;gap:4px;align-items:center;margin-top:4px;text-decoration:none;"><i data-lucide="map-pin" style="width:12px;height:12px"></i> Open Map: ${l.location_in}</a>` : `<br><span style="color:var(--text-secondary);font-size:0.75rem;display:inline-flex;gap:4px;align-items:center;margin-top:4px;opacity:0.7;"><i data-lucide="map-pin-off" style="width:12px;height:12px"></i> No GPS Location</span>`}
        </div>
        <div class="log-duration" style="text-align:right">
          ${parseFloat(l.duration).toFixed(2)}h
          <br><small style="font-size:0.75rem;color:${l.approval_status === 'approved' ? 'var(--success)' : l.approval_status === 'rejected' ? 'var(--danger)' : 'var(--warning)'}">${(l.approval_status || 'pending').toUpperCase()}</small>
        </div>
        ${l.notes ? `<div class="log-notes" style="grid-column: span 2">${l.notes}</div>` : ''}
        
        ${l.photo_url ? `
          <div style="grid-column: span 2; margin-top: 8px;">
            <a href="${l.photo_url}" target="_blank" style="display:inline-flex; align-items:center; gap:6px; font-size: 0.8rem; color: var(--primary); text-decoration:none;">
              <i data-lucide="image" style="width:16px;height:16px"></i> View Attached Proof
            </a>
          </div>
        ` : `
          <div style="grid-column: span 2; margin-top: 8px;">
            <div style="display:inline-flex; align-items:center; gap:6px; font-size: 0.75rem; color: var(--text-secondary);">
              <i data-lucide="image-off" style="width:16px;height:16px"></i> No Photo Attached
            </div>
          </div>
        `}

        ${l.approval_status === 'approved' ? `
          <div class="log-actions-native" style="justify-content:center">
             <span style="color:var(--success);font-size:0.8rem;display:flex;align-items:center;gap:4px;"><i data-lucide="check-circle"></i> Log Approved - Locked</span>
          </div>
        ` : `
          <div class="log-actions-native">
             <button class="action-icon-btn primary" onclick="window.handleEdit(${l.id})">
               <i data-lucide="edit-3"></i> Edit
             </button>
             <button class="action-icon-btn danger" onclick="window.handleArchive(${l.id})">
               <i data-lucide="trash-2"></i> Archive
             </button>
          </div>
        `}
      </div>
    `;

  const html = logs.length === 0 ? '<div class="empty-state">No logs found for this period.</div>' : logs.map(generateHtml).join('');
  if (list) list.innerHTML = html;
  createIcons({ icons: ICON_LIB });
}

function renderHistoryLogs() {
  const list = document.getElementById('history-logs-list');
  if (!list) return;
  // Skip limit for full history
  const logs = getLogs(null, true);
  const generateHtml = (l) => `
      <div class="log-item">
        <div class="log-date-info">
          <span class="l-date">${l.date}</span>
          <span class="l-time">${l.time_in} - ${l.time_out}</span>
          ${l.location_in ? `<br><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.location_in)}" target="_blank" style="color:var(--text-secondary);font-size:0.75rem;display:inline-flex;gap:4px;align-items:center;margin-top:4px;text-decoration:none;"><i data-lucide="map-pin" style="width:12px;height:12px"></i> Open Map: ${l.location_in}</a>` : `<br><span style="color:var(--text-secondary);font-size:0.75rem;display:inline-flex;gap:4px;align-items:center;margin-top:4px;opacity:0.7;"><i data-lucide="map-pin-off" style="width:12px;height:12px"></i> No GPS Location</span>`}
        </div>
        <div class="log-duration" style="text-align:right">
          ${parseFloat(l.duration).toFixed(2)}h
          <br><small style="font-size:0.75rem;color:${l.approval_status === 'approved' ? 'var(--success)' : l.approval_status === 'rejected' ? 'var(--danger)' : 'var(--warning)'}">${(l.approval_status || 'pending').toUpperCase()}</small>
        </div>

        ${l.photo_url ? `
          <div style="grid-column: span 2; margin-top: 8px;">
            <a href="${l.photo_url}" target="_blank" style="display:inline-flex; align-items:center; gap:6px; font-size: 0.8rem; color: var(--primary); text-decoration:none;">
              <i data-lucide="image" style="width:16px;height:16px"></i> View Attached Proof
            </a>
          </div>
        ` : `
          <div style="grid-column: span 2; margin-top: 8px;">
            <div style="display:inline-flex; align-items:center; gap:6px; font-size: 0.75rem; color: var(--text-secondary);">
              <i data-lucide="image-off" style="width:16px;height:16px"></i> No Photo Attached
            </div>
          </div>
        `}

        ${l.approval_status === 'approved' ? `
          <div class="log-actions-native" style="justify-content:center">
             <span style="color:var(--success);font-size:0.8rem;display:flex;align-items:center;gap:4px;"><i data-lucide="check-circle"></i> Locked</span>
          </div>
        ` : `
          <div class="log-actions-native">
             <button class="action-icon-btn primary" onclick="window.handleEdit(${l.id})">
               <i data-lucide="edit-3"></i> Edit
             </button>
          </div>
        `}
      </div>
    `;
  list.innerHTML = logs.length === 0 ? '<div class="empty-state">No history found.</div>' : logs.map(generateHtml).join('');
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

// Duplicate function removed


function handlePauseResume() {
  const active = getActiveSession();
  if (active.status === 'paused') resumeLog(active.id, new Date().toISOString()); else pauseLog(active.id, new Date().toISOString());
  updateAppUI();
}

async function getLocationCoords() {
  try {
    if (window.Capacitor?.isNative) {
      const perms = await Geolocation.checkPermissions();
      if (perms.location !== 'granted') {
        const req = await Geolocation.requestPermissions();
        if (req.location !== 'granted') return null;
      }
      const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 5000 });
      return `${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)}`;
    } else {
      return new Promise((resolve) => {
        if (!navigator.geolocation) return resolve(null);
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve(`${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
      });
    }
  } catch (e) {
    console.warn("Location error:", e);
    return null;
  }
}

async function refreshTimeoutLocation() {
  const textEl = document.getElementById('location-display-text');
  const linkEl = document.getElementById('location-map-link');
  if (textEl) textEl.textContent = '⏳ Acquiring GPS...';
  if (linkEl) linkEl.style.display = 'none';

  cachedTimeoutLocation = await getLocationCoords();

  if (cachedTimeoutLocation) {
    if (textEl) textEl.textContent = '📍 ' + cachedTimeoutLocation;
    if (linkEl) {
      linkEl.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cachedTimeoutLocation)}`;
      linkEl.style.display = 'inline';
    }
  } else {
    if (textEl) textEl.textContent = '⚠️ Could not get location. Tap Refresh to try again.';
  }
}

async function handleTimeIn() {
  showToast('Acquiring Location...', 'info');
  const loc = await getLocationCoords();

  const now = new Date();

  // Attempt to re-init if db is missing
  let success = addLog(now.toLocaleDateString(), now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), now.toISOString(), loc);

  if (!success) {
    console.log("DB missing, trying to re-init...");
    await initDatabase();
    success = addLog(now.toLocaleDateString(), now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), now.toISOString(), loc);
  }

  if (success) {
    startNativeTimer();
    updateAppUI();
    showToast('Time In recorded!', 'success');
  } else {
    showToast('Database Error: Tap Settings > Recycle Bin > Delete All Data to reset.', 'error');
  }
}



async function confirmTimeOut() {
  const active = getActiveSession(); if (!active) return;

  const photoInput = document.getElementById('log-photo-input');
  if (!photoInput?.files?.length) {
    return showToast('Please attach a proof photo to finish your session.', 'error');
  }

  const notes = document.getElementById('log-notes-input')?.value || '';
  const confirmBtn = document.getElementById('confirm-timeout-btn');
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Uploading...'; }

  try {
    showToast('Processing photo...', 'info');
    const photoData = await processPhoto(photoInput.files[0]);
    const loc = cachedTimeoutLocation || await getLocationCoords();

    const start = new Date(active.iso_start).getTime();
    const pastPaused = parseInt(active.total_paused_ms) || 0;
    const duration = (Date.now() - start - pastPaused) / (1000 * 60 * 60);
    const timeOut = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Upload photo to Firebase Storage → store URL in SQLite
    // On localhost (dev), Firebase Storage CORS blocks uploads — skip and defer to APK/next sync
    let photoUrl = null;
    const isNative = !!window.Capacitor?.isNative;
    const isLocalhost = !isNative && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const logId = `${active.date}_${active.time_in}`.replace(/\//g, '-');

    if (photoData && auth.currentUser && !isLocalhost) {
      // On the APK / production: upload directly
      try {
        showToast('Uploading photo...', 'info');
        const imgRef = ref(storage, `users/${auth.currentUser.uid}/logs/${logId}.jpg`);
        await uploadString(imgRef, photoData, 'data_url');
        photoUrl = await getDownloadURL(imgRef);
        console.log('[Photo] Uploaded OK:', photoUrl.length, 'chars URL');
      } catch (uploadErr) {
        console.warn('[Photo] Upload failed, deferring:', uploadErr.message);
        try {
          const localforage = (await import('localforage')).default;
          await localforage.setItem(`pending_photo_${logId}`, photoData);
        } catch (e) { /* ignore */ }
        showToast('Photo saved — will upload on next sync.', 'info');
      }
    } else if (photoData && isLocalhost) {
      // On localhost dev: skip upload entirely (CORS), just defer
      console.log('[Photo] Localhost detected — deferring photo upload to APK/next sync');
      try {
        const localforage = (await import('localforage')).default;
        await localforage.setItem(`pending_photo_${logId}`, photoData);
        console.log('[Photo] Deferred photo saved to localForage');
      } catch (e) { /* ignore */ }
      showToast('Dev mode: Photo deferred (will upload on APK).', 'info');
    } else if (!auth.currentUser) {
      console.warn('[Photo] Not logged in, skipping upload');
    }

    const finalUpdates = {
      time_out: timeOut,
      status: 'completed', notes, duration, approvalStatus: 'pending'
    };
    if (loc) { finalUpdates.locationIn = loc; finalUpdates.locationOut = loc; }
    if (photoUrl) { finalUpdates.photoUrl = photoUrl; }

    console.log('[Save] Updates:', Object.keys(finalUpdates), 'photoUrl present:', !!photoUrl);
    updateLog(active.id, finalUpdates);

    // Immediately stop the JS interval timer
    stopSessionTimer();
    timerServiceStarted = false;
    if (window.Capacitor?.isNative) {
      try { await Timer.stopNativeTimer(); } catch (e) { /* ignore */ }
    }

    document.getElementById('timeout-modal').classList.add('hidden');
    document.getElementById('log-notes-input').value = '';
    cachedTimeoutLocation = null;
    if (photoInput) photoInput.value = '';
    updateAppUI();
    renderJournalLogs();
    await syncCloud();
    showToast('Session saved!', 'success');
  } catch (e) {
    console.error('[confirmTimeOut] Error:', e);
    showToast('Error saving session: ' + e.message, 'error');
  } finally {
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Finish & Sign Log'; }
  }
}

async function processPhoto(file) {
  return new Promise((resolve) => {
    try {
      if (!file) {
        showToast('No file detected', 'error');
        return resolve(null);
      }

      const img = document.createElement('img');
      const objectUrl = URL.createObjectURL(file);

      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 800;
          let width = img.width || 800;
          let height = img.height || 800;

          if (width > MAX_WIDTH) {
            height = Math.round((height * MAX_WIDTH) / width);
            width = MAX_WIDTH;
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          URL.revokeObjectURL(objectUrl);
          const compressed = canvas.toDataURL('image/jpeg', 0.6);
          resolve(compressed);
        } catch (err) {
          showToast('Image Compress Error: ' + err.message, 'error');
          resolve(null);
        }
      };

      img.onerror = () => {
        showToast('Corrupted file format', 'error');
        URL.revokeObjectURL(objectUrl);
        resolve(null);
      };

      img.src = objectUrl;
    } catch (e) {
      showToast('Processing Exception: ' + e.message, 'error');
      resolve(null);
    }
  });
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
  window.currentUserRole = userData.role;
  if (!userData.role) { document.getElementById('google-setup-modal').classList.remove('hidden'); return; }
  document.getElementById('auth-container').classList.add('hidden');
  document.getElementById('root').classList.remove('hidden');
  if (userData.role === 'teacher') { switchView('teacher-section'); loadTeacherData(userData); }
  else { switchView('home'); updateAppUI(); }

  // Now setup tabs, because JS now knows the role
  setupViewNavigation();
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
  if (!window.Capacitor?.isNative) return;
  try {
    if (typeof Timer !== 'undefined' && Timer.addListener) {
      Timer.addListener('PAUSE', handlePauseResume);
      Timer.addListener('TIMEOUT', () => document.getElementById('timeout-modal')?.classList.remove('hidden'));
    }
  } catch (e) { console.warn("Timer listeners failed", e); }
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

  // Sort: pending first (newest on top), then approved/rejected (newest on top)
  const statusOrder = { 'pending': 0, 'approved': 1, 'rejected': 1 };
  const sortedLogs = [...(s.logs || [])].sort((a, b) => {
    const sA = statusOrder[a.approval_status] ?? 0;
    const sB = statusOrder[b.approval_status] ?? 0;
    if (sA !== sB) return sA - sB;
    // Within same group: sort by date desc, then time_in desc
    const dateCompare = (b.date || '').localeCompare(a.date || '');
    if (dateCompare !== 0) return dateCompare;
    // Convert AM/PM time to comparable 24h number
    const toMins = (t) => {
      if (!t) return 0;
      const [timePart, period] = t.split(' ');
      let [h, m] = timePart.split(':').map(Number);
      if (period === 'PM' && h !== 12) h += 12;
      if (period === 'AM' && h === 12) h = 0;
      return h * 60 + m;
    };
    return toMins(b.time_in) - toMins(a.time_in);
  });

  list.innerHTML = sortedLogs.map(l => {
    const logId = `${l.date}_${l.time_in}`.replace(/\//g, '-');
    return `<div class="log-item" style="display:flex; flex-wrap:wrap; align-items:flex-start;">
      <div style="margin-right: 12px; margin-top: 4px;">
        <input type="checkbox" name="log-select-cb" value="${logId}" style="width: 18px; height: 18px; cursor:pointer;" ${l.approval_status === 'approved' ? 'disabled' : ''}>
      </div>
      <div class="log-date-info" style="flex:1;">
        <b>${l.date}</b><br>${l.time_in} - ${l.time_out}
        ${l.location_in ? `<br><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.location_in)}" target="_blank" style="display:inline-flex;align-items:center;gap:5px;margin-top:6px;padding:5px 10px;background:var(--primary);color:#fff;border-radius:20px;font-size:0.72rem;font-weight:600;text-decoration:none;letter-spacing:0.3px;"><i data-lucide="map-pin" style="width:12px;height:12px"></i> View Map</a>` : `<br><span style="color:var(--warning);font-size:0.75rem;display:inline-flex;gap:4px;align-items:center;margin-top:4px;"><i data-lucide="map-pin-off" style="width:12px;height:12px"></i> Unverified Location</span>`}
        ${l.notes ? `<div style="font-size: 0.8rem; margin-top: 4px; padding: 4px 8px; background: rgba(0,0,0,0.05); border-radius: 4px;"><i>"${l.notes}"</i></div>` : ''}
        
        ${l.photo_url ? (
        l.photo_url.startsWith('data:image') ? `
          <div style="margin-top: 8px;">
            <img src="${l.photo_url}" alt="Proof Photo" style="width:100%;max-width:260px;border-radius:8px;border:1px solid var(--border);object-fit:cover;display:block;">
          </div>` : `
          <div style="margin-top: 8px;">
            <a href="${l.photo_url}" target="_blank" style="display:inline-flex;align-items:center;gap:6px;padding:5px 12px;background:rgba(var(--primary-rgb,99,102,241),0.15);color:var(--primary);border-radius:20px;font-size:0.75rem;font-weight:600;text-decoration:none;">
              <i data-lucide="image" style="width:14px;height:14px"></i> View Photo Proof
            </a>
          </div>`
      ) : `
          <div style="margin-top: 8px;">
            <div style="display:inline-flex; align-items:center; gap:6px; font-size: 0.75rem; color: var(--text-secondary);">
              <i data-lucide="image-off" style="width:16px;height:16px"></i> No Photo
            </div>
          </div>
        `}
      </div>
      <div class="log-duration" style="text-align:right">
        ${parseFloat(l.duration).toFixed(1)}h
        <br><small style="font-size:0.75rem;font-weight:bold;color:${l.approval_status === 'approved' ? 'var(--success)' : l.approval_status === 'rejected' ? 'var(--danger)' : 'var(--warning)'}">${(l.approval_status || 'pending').toUpperCase()}</small>
      </div>
      <div class="log-actions-native" style="margin-top: 8px;">
        <button class="action-icon-btn recover" style="padding: 6px 14px; min-height: unset;" onclick="window.teacherLogAction('${id}', '${l.date}', '${l.time_in}', 'approved')"><i data-lucide="check"></i> Approve</button>
        <button class="action-icon-btn danger" style="padding: 6px 14px; min-height: unset;" onclick="window.teacherLogAction('${id}', '${l.date}', '${l.time_in}', 'rejected')"><i data-lucide="x"></i> Reject</button>
      </div>
    </div>`;
  }).join('');

  // reset bulk check
  const selectAllCb = document.getElementById('bulk-select-all');
  if (selectAllCb) selectAllCb.checked = false;

  switchView('student-detail-view');
  createIcons({ icons: ICON_LIB });
};

window.teacherLogAction = async (studentId, date, timeIn, status) => {
  const logId = `${date}_${timeIn}`.replace(/\//g, '-');
  await updateDoc(doc(db, "users", studentId, "logs", logId), { approval_status: status });
  const toastText = status === 'approved' ? 'Log Approved!' : 'Log Rejected!';
  showToast(toastText, status === 'approved' ? 'success' : 'error');
  window.viewStudentDetail(studentId); // re-render list
};

window.toggleSelectAllLogs = (el) => {
  document.querySelectorAll('input[name="log-select-cb"]:not([disabled])').forEach(cb => {
    cb.checked = el.checked;
  });
};

window.bulkApproveLogs = async () => {
  if (!currentViewingStudentId) return;
  const cbs = Array.from(document.querySelectorAll('input[name="log-select-cb"]:checked'));
  if (cbs.length === 0) return showToast('No logs selected', 'warning');

  showToast('Approving selected logs...', 'info');
  await Promise.all(cbs.map(cb => {
    return updateDoc(doc(db, "users", currentViewingStudentId, "logs", cb.value), { approval_status: 'approved' });
  }));
  showToast(`Successfully approved ${cbs.length} logs!`, 'success');
  window.viewStudentDetail(currentViewingStudentId);
};

window.bulkRejectLogs = async () => {
  if (!currentViewingStudentId) return;
  const cbs = Array.from(document.querySelectorAll('input[name="log-select-cb"]:checked'));
  if (cbs.length === 0) return showToast('No logs selected', 'warning');

  showToast('Rejecting selected logs...', 'info');
  await Promise.all(cbs.map(cb => {
    return updateDoc(doc(db, "users", currentViewingStudentId, "logs", cb.value), { approval_status: 'rejected' });
  }));
  showToast(`Successfully rejected ${cbs.length} logs!`, 'success');
  window.viewStudentDetail(currentViewingStudentId);
};

async function syncCloud() {
  if (!navigator.onLine) {
    updateSyncIndicator('offline');
    return;
  }

  updateSyncIndicator('syncing');
  // Pass true to get ALL logs for cloud sync, not just the dashboard 50
  const logs = getLogs(null, true);
  const settings = getSettings();
  const res = await syncLocalDataToCloud(logs, settings);

  if (res.statusUpdates && res.statusUpdates.length > 0) {
    res.statusUpdates.forEach(u => updateLog(u.id, {
      approval_status: u.approval_status,
      ...(u.photo_url && { photoUrl: u.photo_url })
    }));
    renderJournalLogs();
    if (document.getElementById('view-history')?.classList.contains('hidden') === false) {
      renderHistoryLogs();
    }
  }

  setTimeout(() => {
    updateSyncIndicator(res.success ? 'online' : 'offline');
  }, 1000);
}




window.handleEdit = (id) => {
  const logs = getLogs(null, true);
  const log = logs.find(l => l.id === id);
  if (!log) return;

  const modal = document.getElementById('edit-modal');
  document.getElementById('edit-date').value = log.date;

  // Format time for 24h input (H:MM AM/PM -> HH:mm)
  const parseTime = (t) => {
    if (!t) return "";
    const [time, modifier] = t.split(' ');
    let [hours, minutes] = time.split(':');
    let h = parseInt(hours, 10);
    if (h === 12) h = 0;
    if (modifier === 'PM') h += 12;
    return `${String(h).padStart(2, '0')}:${minutes}`;
  };

  document.getElementById('edit-time-in').value = parseTime(log.time_in);
  document.getElementById('edit-time-out').value = parseTime(log.time_out);
  document.getElementById('edit-notes').value = log.notes || "";

  modal.dataset.editingId = id;
  modal.classList.remove('hidden');
};

async function handleUpdateLog_Unified() {
  const modal = document.getElementById('edit-modal');
  const id = parseInt(modal.dataset.editingId);
  const date = document.getElementById('edit-date').value;
  const timeInRaw = document.getElementById('edit-time-in').value;
  const timeOutRaw = document.getElementById('edit-time-out').value;
  const notes = document.getElementById('edit-notes').value;

  if (!date || !timeInRaw || !timeOutRaw) {
    showToast("Please fill all fields", "error");
    return;
  }

  const formatTime = (t) => {
    let [h, m] = t.split(':');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${ampm}`;
  };

  const timeIn = formatTime(timeInRaw);
  const timeOut = formatTime(timeOutRaw);

  const [h1, m1] = timeInRaw.split(':').map(Number);
  const [h2, m2] = timeOutRaw.split(':').map(Number);
  let dur = (h2 * 60 + m2 - (h1 * 60 + m1)) / 60;
  if (dur < 0) dur += 24;

  const iso_start = `${date}T${timeInRaw}:00`;
  const success = updateLog(id, { date, timeIn, timeOut, duration: dur, notes, iso_start });

  if (success) {
    showToast("Log updated successfully", "success");
    modal.classList.add('hidden');
    renderJournalLogs();
    if (document.getElementById('view-history')?.classList.contains('hidden') === false) {
      renderHistoryLogs();
    }
    syncCloud();
  } else {
    showToast("Failed to update log", "error");
  }
}

async function startNativeTimer() {

  timerServiceStarted = false; await updateMediaNotification('00:00:00');
}

startApp();
