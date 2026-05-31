import { parsePdfFile } from './pdf-parser.js';
import { saveWeeks, loadWeeks, clearAll } from './storage.js';
import { verifyCredentials, isLoggedIn, logout, watchAuthState } from './auth.js';
import { firebaseConfigured } from './firebase.js';
import { renderWeek, findCurrentWeekIndex, formatTodayLabel } from './ui.js';

const dom = {
  weekCard: document.getElementById('week-card'),
  emptyState: document.getElementById('empty-state'),
  waitingState: document.getElementById('waiting-state'),
  weekNav: document.getElementById('week-nav'),
  prevBtn: document.getElementById('prev-week-btn'),
  nextBtn: document.getElementById('next-week-btn'),
  weekPosition: document.getElementById('week-position'),
  statusBar: document.getElementById('status-bar'),
  footerInfo: document.getElementById('footer-info'),

  // Modal
  modal: document.getElementById('admin-modal'),
  openAdminBtn: document.getElementById('admin-open-btn'),
  loginSection: document.getElementById('admin-login-section'),
  panelSection: document.getElementById('admin-panel-section'),
  loginForm: document.getElementById('admin-login-form'),
  loginError: document.getElementById('admin-login-error'),
  uploadForm: document.getElementById('upload-form'),
  pdfFileInput: document.getElementById('pdf-file'),
  pdfYearInput: document.getElementById('pdf-year'),
  uploadStatus: document.getElementById('upload-status'),
  uploadError: document.getElementById('upload-error'),
  clearDataBtn: document.getElementById('clear-data-btn'),
  logoutBtn: document.getElementById('admin-logout-btn'),
  weeksSummary: document.getElementById('weeks-summary'),
  weeksList: document.getElementById('weeks-list'),

  // Install prompt
  installPrompt: document.getElementById('install-prompt'),
  installBtn: document.getElementById('install-btn'),
  installDismissBtn: document.getElementById('install-dismiss-btn'),
};

const state = {
  weeks: [],
  meta: null,
  viewIndex: 0,
  baseIndex: 0,
  baseKind: 'past',
};

async function init() {
  attachListeners();
  registerServiceWorker();
  setupInstallPrompt();
  dom.statusBar.textContent = formatTodayLabel();
  if (firebaseConfigured()) {
    // Keep our local session flag in sync with Firebase auth state.
    watchAuthState().catch(() => {});
  }
  await refreshFromStorage();
}

function attachListeners() {
  dom.openAdminBtn.addEventListener('click', openAdminModal);
  dom.modal.addEventListener('click', (e) => {
    if (e.target instanceof HTMLElement && e.target.dataset.closeModal !== undefined) {
      closeAdminModal();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dom.modal.hidden) closeAdminModal();
  });

  dom.loginForm.addEventListener('submit', onLoginSubmit);
  dom.uploadForm.addEventListener('submit', onUploadSubmit);
  dom.clearDataBtn.addEventListener('click', onClearData);
  dom.logoutBtn.addEventListener('click', async () => {
    await logout();
    showLoginSection();
    closeAdminModal();
  });

  dom.prevBtn.addEventListener('click', () => navigate(-1));
  dom.nextBtn.addEventListener('click', () => navigate(+1));
}

function openAdminModal() {
  dom.modal.hidden = false;
  dom.modal.setAttribute('aria-hidden', 'false');
  if (isLoggedIn()) showAdminPanelSection();
  else showLoginSection();
}

function closeAdminModal() {
  dom.modal.hidden = true;
  dom.modal.setAttribute('aria-hidden', 'true');
  dom.loginError.hidden = true;
  dom.uploadError.hidden = true;
  dom.uploadStatus.hidden = true;
}

function showLoginSection() {
  dom.loginSection.hidden = false;
  dom.panelSection.hidden = true;
  setTimeout(() => document.getElementById('admin-username')?.focus(), 50);
}

function showAdminPanelSection() {
  dom.loginSection.hidden = true;
  dom.panelSection.hidden = false;
  renderAdminWeeksList();
}

async function onLoginSubmit(e) {
  e.preventDefault();
  dom.loginError.hidden = true;
  const email = document.getElementById('admin-username').value;
  const password = document.getElementById('admin-password').value;
  const result = await verifyCredentials(email, password);
  if (result.ok) {
    showAdminPanelSection();
    dom.loginForm.reset();
  } else {
    dom.loginError.textContent = result.error || 'Correo o contraseña incorrectos.';
    dom.loginError.hidden = false;
  }
}

async function onUploadSubmit(e) {
  e.preventDefault();
  dom.uploadError.hidden = true;
  dom.uploadStatus.hidden = false;
  dom.uploadStatus.classList.remove('success');
  dom.uploadStatus.textContent = 'Procesando PDF…';

  const file = dom.pdfFileInput.files?.[0];
  if (!file) {
    dom.uploadError.textContent = 'Por favor seleccione un archivo PDF.';
    dom.uploadError.hidden = false;
    dom.uploadStatus.hidden = true;
    return;
  }

  const yearOverrideRaw = dom.pdfYearInput.value;
  const yearOverride = yearOverrideRaw ? Number(yearOverrideRaw) : undefined;

  try {
    const parsed = await parsePdfFile(file, { yearOverride });
    if (!parsed.weeks.length) {
      throw new Error('No se detectaron semanas en el PDF. Verifique que el archivo es del programa Vida y Ministerio.');
    }
    const meta = {
      uploadedAt: Date.now(),
      year: parsed.year,
      yearSource: parsed.detectedYearSource,
      pageCount: parsed.pageCount,
      weekCount: parsed.weeks.length,
      fileName: parsed.fileName,
      sizeBytes: parsed.sizeBytes,
    };
    dom.uploadStatus.textContent = 'Publicando en el servidor compartido…';
    await saveWeeks(parsed.weeks, meta, file);
    dom.uploadStatus.textContent = `${parsed.weeks.length} semanas guardadas y publicadas para todos.`;
    dom.uploadStatus.classList.add('success');
    await refreshFromStorage();
  } catch (err) {
    console.error(err);
    dom.uploadError.textContent = err?.message || 'No se pudo procesar el PDF.';
    dom.uploadError.hidden = false;
    dom.uploadStatus.hidden = true;
  }
}

async function onClearData() {
  if (!confirm('¿Está seguro de borrar todas las asignaciones guardadas? Esta acción no se puede deshacer.')) return;
  await clearAll();
  await refreshFromStorage();
  renderAdminWeeksList();
  dom.uploadStatus.hidden = true;
  dom.uploadError.hidden = true;
}

async function refreshFromStorage() {
  const { weeks, meta } = await loadWeeks();
  state.weeks = weeks;
  state.meta = meta;

  if (!weeks.length) {
    dom.emptyState.hidden = false;
    dom.waitingState.hidden = true;
    dom.weekCard.hidden = true;
    dom.weekNav.hidden = true;
    updateFooterInfo();
    return;
  }
  dom.emptyState.hidden = true;

  const { index, kind } = findCurrentWeekIndex(weeks);
  state.baseKind = kind;
  if (kind === 'past') {
    dom.waitingState.hidden = false;
    dom.weekCard.hidden = true;
    dom.weekNav.hidden = false;
    state.baseIndex = weeks.length - 1;
    state.viewIndex = weeks.length - 1;
    renderCurrent();
    return;
  }
  dom.waitingState.hidden = true;
  state.baseIndex = index;
  state.viewIndex = index;
  dom.weekCard.hidden = false;
  dom.weekNav.hidden = false;
  renderCurrent();
}

function renderCurrent() {
  const w = state.weeks[state.viewIndex];
  if (!w) return;
  let label = 'Semana actual';
  if (state.baseKind === 'upcoming' && state.viewIndex === state.baseIndex) {
    label = 'Próxima semana';
  } else if (state.viewIndex < state.baseIndex) {
    label = 'Semana anterior';
  } else if (state.viewIndex > state.baseIndex) {
    label = 'Semana siguiente';
  } else if (state.baseKind === 'past') {
    label = 'Última semana cargada';
  }
  // Show the week card even on "past" view (so user can look back).
  dom.weekCard.hidden = false;
  renderWeek(w, { container: dom.weekCard, label });

  dom.weekPosition.textContent = `${state.viewIndex + 1} / ${state.weeks.length}`;
  dom.prevBtn.disabled = state.viewIndex <= 0;
  dom.nextBtn.disabled = state.viewIndex >= state.weeks.length - 1;
  updateFooterInfo();
}

function navigate(delta) {
  const newIdx = state.viewIndex + delta;
  if (newIdx < 0 || newIdx >= state.weeks.length) return;
  state.viewIndex = newIdx;
  if (state.baseKind === 'past') {
    dom.waitingState.hidden = true;
  }
  renderCurrent();
}

function renderAdminWeeksList() {
  if (!state.weeks.length) {
    dom.weeksSummary.hidden = true;
    dom.weeksList.innerHTML = '';
    return;
  }
  dom.weeksSummary.hidden = false;
  const { index } = findCurrentWeekIndex(state.weeks);
  dom.weeksList.innerHTML = state.weeks
    .map((w, i) => {
      const cls = i === index ? 'is-current' : '';
      const bible = w.bible ? ` — ${escapeHtml(w.bible)}` : '';
      return `<li class="${cls}">${escapeHtml(w.humanDate)}${bible}</li>`;
    })
    .join('');
}

function updateFooterInfo() {
  if (!state.meta || !state.meta.uploadedAt) {
    dom.footerInfo.textContent = '';
    return;
  }
  const date = new Date(state.meta.uploadedAt).toLocaleDateString('es', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const count = state.meta.weekCount ?? state.weeks.length;
  dom.footerInfo.textContent = `${count} semanas cargadas · subido el ${date}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./service-worker.js', { scope: './' })
        .catch((err) => console.warn('SW registration failed:', err));
    });
  }
}

let deferredInstallPrompt = null;
function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (sessionStorage.getItem('install-dismissed')) return;
    dom.installPrompt.hidden = false;
  });
  dom.installBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice.catch(() => {});
    deferredInstallPrompt = null;
    dom.installPrompt.hidden = true;
  });
  dom.installDismissBtn.addEventListener('click', () => {
    dom.installPrompt.hidden = true;
    sessionStorage.setItem('install-dismissed', '1');
  });
  window.addEventListener('appinstalled', () => {
    dom.installPrompt.hidden = true;
  });
}

init().catch((err) => {
  console.error('Init failed', err);
  dom.statusBar.textContent = 'Ocurrió un error iniciando la aplicación.';
});
