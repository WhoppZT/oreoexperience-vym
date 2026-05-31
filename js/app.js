import { parsePdfFile } from './pdf-parser.js';
import { saveWeeks, loadWeeks, clearAll } from './storage.js';
import { saveAcomodadoresImage, loadAcomodadoresImage, clearAcomodadoresImage } from './storage.js';
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

  // Admin tabs
  adminTabBtns: document.querySelectorAll('.admin-tab-btn'),
  adminTabAsignaciones: document.getElementById('admin-tab-asignaciones'),
  adminTabAcomodadores: document.getElementById('admin-tab-acomodadores'),

  // Acomodadores upload
  acomodadoresUploadForm: document.getElementById('acomodadores-upload-form'),
  acomodadoresFileInput: document.getElementById('acomodadores-file'),
  acomodadoresUploadStatus: document.getElementById('acomodadores-upload-status'),
  acomodadoresUploadError: document.getElementById('acomodadores-upload-error'),
  acomodadoresClearBtn: document.getElementById('acomodadores-clear-btn'),
  acomodadoresPreview: document.getElementById('acomodadores-preview'),
  acomodadoresPreviewImg: document.getElementById('acomodadores-preview-img'),

  // Acomodadores display
  acomodadoresImageDisplay: document.getElementById('acomodadores-image-display'),
  acomodadoresDisplayImg: document.getElementById('acomodadores-display-img'),
  acomodadoresDefaultTables: document.getElementById('acomodadores-default-tables'),

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
    watchAuthState().catch(() => {});
  }
  await refreshFromStorage();
  await loadAcomodadoresDisplay();
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

  // Section tabs (Asignaciones / Acomodadores)
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Admin tabs
  dom.adminTabBtns.forEach((btn) => {
    btn.addEventListener('click', () => switchAdminTab(btn.dataset.adminTab));
  });

  // Acomodadores upload
  dom.acomodadoresUploadForm.addEventListener('submit', onAcomodadoresUpload);
  dom.acomodadoresClearBtn.addEventListener('click', onAcomodadoresClear);
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-content').forEach((content) => {
    const isActive = content.id === `tab-${tabId}`;
    content.hidden = !isActive;
    content.classList.toggle('active', isActive);
  });
}

function switchAdminTab(tabId) {
  dom.adminTabBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.adminTab === tabId);
  });
  dom.adminTabAsignaciones.hidden = tabId !== 'asignaciones';
  dom.adminTabAsignaciones.classList.toggle('active', tabId === 'asignaciones');
  dom.adminTabAcomodadores.hidden = tabId !== 'acomodadores';
  dom.adminTabAcomodadores.classList.toggle('active', tabId === 'acomodadores');
}

function compressImage(file, maxWidth = 1200, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width;
        let h = img.height;
        if (w > maxWidth) {
          h = (h * maxWidth) / w;
          w = maxWidth;
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function onAcomodadoresUpload(e) {
  e.preventDefault();
  dom.acomodadoresUploadError.hidden = true;
  dom.acomodadoresUploadStatus.hidden = false;
  dom.acomodadoresUploadStatus.classList.remove('success');
  dom.acomodadoresUploadStatus.textContent = 'Procesando imagen…';

  const file = dom.acomodadoresFileInput.files?.[0];
  if (!file) {
    dom.acomodadoresUploadError.textContent = 'Seleccione una imagen.';
    dom.acomodadoresUploadError.hidden = false;
    dom.acomodadoresUploadStatus.hidden = true;
    return;
  }

  try {
    const dataUrl = await compressImage(file);
    dom.acomodadoresUploadStatus.textContent = 'Guardando en el servidor…';
    await saveAcomodadoresImage(dataUrl);
    dom.acomodadoresUploadStatus.textContent = 'Imagen guardada y publicada.';
    dom.acomodadoresUploadStatus.classList.add('success');
    dom.acomodadoresPreview.hidden = false;
    dom.acomodadoresPreviewImg.src = dataUrl;
    await loadAcomodadoresDisplay();
  } catch (err) {
    console.error(err);
    dom.acomodadoresUploadError.textContent = err?.message || 'No se pudo guardar la imagen.';
    dom.acomodadoresUploadError.hidden = false;
    dom.acomodadoresUploadStatus.hidden = true;
  }
}

async function onAcomodadoresClear() {
  if (!confirm('¿Borrar la imagen de acomodadores?')) return;
  try {
    await clearAcomodadoresImage();
    dom.acomodadoresPreview.hidden = true;
    dom.acomodadoresPreviewImg.src = '';
    dom.acomodadoresUploadStatus.hidden = true;
    await loadAcomodadoresDisplay();
  } catch (err) {
    dom.acomodadoresUploadError.textContent = err?.message || 'No se pudo borrar.';
    dom.acomodadoresUploadError.hidden = false;
  }
}

async function loadAcomodadoresDisplay() {
  if (!firebaseConfigured()) {
    dom.acomodadoresImageDisplay.hidden = true;
    dom.acomodadoresDefaultTables.hidden = false;
    return;
  }
  try {
    const dataUrl = await loadAcomodadoresImage();
    if (dataUrl) {
      dom.acomodadoresDisplayImg.src = dataUrl;
      dom.acomodadoresImageDisplay.hidden = false;
      dom.acomodadoresDefaultTables.hidden = true;
      dom.acomodadoresPreview.hidden = false;
      dom.acomodadoresPreviewImg.src = dataUrl;
    } else {
      dom.acomodadoresImageDisplay.hidden = true;
      dom.acomodadoresDefaultTables.hidden = false;
    }
  } catch {
    dom.acomodadoresImageDisplay.hidden = true;
    dom.acomodadoresDefaultTables.hidden = false;
  }
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
        .then((registration) => {
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
                window.location.reload();
              }
            });
          });
        })
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
