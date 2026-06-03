import { parsePdfFile } from './pdf-parser.js';
import * as pdfjsLib from '../vendor/pdf.min.mjs';
import { saveWeeks, loadWeeks, clearAll } from './storage.js';
import { saveAcomodadoresData, loadAcomodadoresData, clearAcomodadoresData } from './storage.js';
import { saveSalidasData, loadSalidasData, clearSalidasData } from './storage.js';
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
  acomodadoresOcrStatus: document.getElementById('acomodadores-ocr-status'),
  ocrProgressText: document.getElementById('ocr-progress-text'),
  acomodadoresUploadError: document.getElementById('acomodadores-upload-error'),
  acomodadoresClearBtn: document.getElementById('acomodadores-clear-btn'),
  acomodadoresOcrResult: document.getElementById('acomodadores-ocr-result'),
  acomodadoresEditor: document.getElementById('acomodadores-editor'),
  acomodadoresSaveBtn: document.getElementById('acomodadores-save-btn'),

  // Acomodadores display (public)
  acomodadoresDefaultTables: document.getElementById('acomodadores-default-tables'),
  acomodadoresNav: document.getElementById('acomodadores-nav'),
  acomodadoresPrevBtn: document.getElementById('acomodadores-prev-btn'),
  acomodadoresNextBtn: document.getElementById('acomodadores-next-btn'),
  acomodadoresPosition: document.getElementById('acomodadores-position'),

  // Salidas de Predicación (public)
  salidasDefaultTables: document.getElementById('salidas-default-tables'),

  // Salidas admin
  salidasUploadForm: document.getElementById('salidas-upload-form'),
  salidasFileInput: document.getElementById('salidas-file'),
  salidasOcrStatus: document.getElementById('salidas-ocr-status'),
  salidasOcrProgressText: document.getElementById('salidas-ocr-progress-text'),
  salidasUploadError: document.getElementById('salidas-upload-error'),
  salidasClearBtn: document.getElementById('salidas-clear-btn'),
  salidasOcrResult: document.getElementById('salidas-ocr-result'),
  salidasEditor: document.getElementById('salidas-editor'),
  salidasSaveBtn: document.getElementById('salidas-save-btn'),

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
  await renderPublicAcomodadores();
  await renderPublicSalidas();
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

  // Acomodadores
  dom.acomodadoresUploadForm.addEventListener('submit', onAcomodadoresUpload);
  dom.acomodadoresClearBtn.addEventListener('click', onAcomodadoresClear);
  dom.acomodadoresSaveBtn?.addEventListener('click', onAcomodadoresSave);

  // Salidas de Predicación
  if (dom.salidasUploadForm) dom.salidasUploadForm.addEventListener('submit', onSalidasUpload);
  if (dom.salidasClearBtn) dom.salidasClearBtn.addEventListener('click', onSalidasClear);
  if (dom.salidasSaveBtn) dom.salidasSaveBtn.addEventListener('click', onSalidasSave);

  // Refresh button
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', forceRefresh);
  }

  if (dom.acomodadoresPrevBtn) {
    dom.acomodadoresPrevBtn.addEventListener('click', () => navigateAcomodadoresWeek(-1));
  }
  if (dom.acomodadoresNextBtn) {
    dom.acomodadoresNextBtn.addEventListener('click', () => navigateAcomodadoresWeek(1));
  }
}

function navigateAcomodadoresWeek(delta) {
  const newIdx = acoState.viewIndex + delta;
  if (newIdx < 0 || newIdx >= acoState.weeks.length) return;
  acoState.viewIndex = newIdx;
  acoState._navigated = true;
  renderPublicAcomodadores();
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
  if (tabId === 'acomodadores') {
    acoState._navigated = false;
    renderPublicAcomodadores();
  }
}

function switchAdminTab(tabId) {
  dom.adminTabBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.adminTab === tabId);
  });
  dom.adminTabAsignaciones.hidden = tabId !== 'asignaciones';
  dom.adminTabAsignaciones.classList.toggle('active', tabId === 'asignaciones');
  dom.adminTabAcomodadores.hidden = tabId !== 'acomodadores';
  dom.adminTabAcomodadores.classList.toggle('active', tabId === 'acomodadores');
  const adminTabSalidas = document.getElementById('admin-tab-salidas');
  if (adminTabSalidas) {
    adminTabSalidas.hidden = tabId !== 'salidas';
    adminTabSalidas.classList.toggle('active', tabId === 'salidas');
  }
  if (tabId === 'acomodadores') loadAdminAcomodadoresPreview();
  if (tabId === 'salidas') loadAdminSalidasPreview();
}

async function forceRefresh() {
  const btn = document.getElementById('refresh-btn');
  if (btn) {
    btn.classList.add('spinning');
    btn.disabled = true;
  }
  showRefreshToast('Buscando actualizaciones...');

  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.update();
        if (reg.waiting) {
          showRefreshToast('Aplicando nueva versión...');
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          await new Promise((resolve) => {
            const onChange = () => {
              navigator.serviceWorker.removeEventListener('controllerchange', onChange);
              resolve();
            };
            navigator.serviceWorker.addEventListener('controllerchange', onChange);
            setTimeout(resolve, 3000);
          });
          window.location.href = window.location.pathname + '?v=' + Date.now();
          return;
        }
      }
    } catch (err) {
      console.warn('SW update check failed:', err);
    }
  }

  showRefreshToast('Limpiando caché...');
  if ('caches' in window) {
    const names = await caches.keys();
    for (const name of names) {
      await caches.delete(name);
    }
  }
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const reg of regs) {
      await reg.unregister();
    }
  }

  window.location.href = window.location.pathname + '?v=' + Date.now();
}

function showRefreshToast(text) {
  let toast = document.getElementById('refresh-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'refresh-toast';
    toast.className = 'refresh-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.hidden = false;
  toast.classList.add('visible');
}

async function onAcomodadoresUpload(e) {
  e.preventDefault();
  dom.acomodadoresUploadError.hidden = true;
  dom.acomodadoresOcrStatus.hidden = false;
  dom.ocrProgressText.textContent = 'Leyendo PDF...';

  const file = dom.acomodadoresFileInput.files?.[0];
  if (!file) {
    dom.acomodadoresUploadError.textContent = 'Seleccione un archivo PDF.';
    dom.acomodadoresUploadError.hidden = false;
    dom.acomodadoresOcrStatus.hidden = true;
    return;
  }

  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;

    const allLines = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      dom.ocrProgressText.textContent = `Leyendo página ${p} de ${pdf.numPages}...`;
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const buckets = new Map();
      for (const item of content.items) {
        if (!item.str || !item.transform) continue;
        const x = item.transform[4];
        const y = item.transform[5];
        const key = Math.round(y);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push({ x, str: item.str });
      }
      const sortedKeys = [...buckets.keys()].sort((a, b) => b - a);
      const merged = [];
      for (const k of sortedKeys) {
        if (merged.length && Math.abs(merged[merged.length - 1].key - k) <= 3) {
          merged[merged.length - 1].items.push(...buckets.get(k));
        } else {
          merged.push({ key: k, items: [...buckets.get(k)] });
        }
      }
      for (const row of merged) {
        row.items.sort((a, b) => a.x - b.x);
        const line = row.items.map(it => it.str).join('  ').trim();
        if (line) allLines.push(line);
      }
    }

    const rawText = allLines.join('\n');
    console.log('=== PDF RAW TEXT ===');
    console.log(rawText);
    console.log('=== END PDF ===');

    const parsed = parseAcomodadoresText(allLines);
    pendingAcomodadoresData = parsed;
    renderAcomodadoresEditor(parsed, rawText);
    dom.acomodadoresOcrStatus.hidden = true;
    dom.acomodadoresOcrResult.hidden = false;
  } catch (err) {
    console.error(err);
    dom.acomodadoresUploadError.textContent = 'No se pudo leer el PDF. Intente con otro archivo.';
    dom.acomodadoresUploadError.hidden = false;
    dom.acomodadoresOcrStatus.hidden = true;
  }
}

let pendingAcomodadoresData = null;

function parseAcomodadoresText(lines) {
  const months = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
  const weekdays = ['DOMINGO','LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO',
    'DOM','LUN','MAR','MIE','JUE','VIE','SAB'];
  const weekdayToShort = { DOMINGO:'SAB', LUNES:'LUN', MARTES:'MAR', MIERCOLES:'MIE', JUEVES:'JUE', VIERNES:'VIE', SABADO:'SAB' };
  const stopWords = new Set(['DE','DEL','LA','LAS','LOS','EL','EN','Y','A','LA','PARA','CON','POR','UN','UNA']);

  const sections = [
    { id: 'acomodadores', title: 'Acomodadores', slotLabels: ['Parqueadero', 'Entrada'], entries: [] },
    { id: 'microfonos', title: 'Microfonos', slotLabels: ['Asignado 1', 'Asignado 2'], entries: [] },
    { id: 'plataforma', title: 'Plataforma', slotLabels: ['Asignado'], entries: [] },
    { id: 'salidas_predicacion', title: 'Salidas de Predicación', slotLabels: ['Capitán'], entries: [] },
  ];

  let currentSection = null;
  let lastEntry = null;

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const prev = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      let prevDiag = prev[0];
      prev[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = prev[j];
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, prevDiag + cost);
        prevDiag = tmp;
      }
    }
    return prev[b.length];
  }

  function fuzzyMatchWord(word, candidates) {
    if (!word || word.length < 3) return null;
    const upper = word.toUpperCase();
    for (const c of candidates) {
      if (upper === c) return c;
    }
    let best = null;
    let bestDist = Infinity;
    let bestLen = 0;
    for (const c of candidates) {
      if (Math.abs(upper.length - c.length) > 2) continue;
      const dist = levenshtein(upper, c);
      if (dist < bestDist) {
        bestDist = dist;
        best = c;
        bestLen = c.length;
      }
    }
    const threshold = bestLen >= 6 ? 2 : 1;
    return bestDist <= threshold ? best : null;
  }

  function detectMonth(upper) {
    const tokens = upper.split(/\s+/);
    for (const t of tokens) {
      const m = fuzzyMatchWord(t, months);
      if (m) return m;
    }
    return '';
  }

  function detectWeekday(upper) {
    const tokens = upper.split(/\s+/);
    for (const t of tokens) {
      const w = fuzzyMatchWord(t, weekdays);
      if (w) return w.length > 3 ? (weekdayToShort[w] || w.substring(0, 3)) : w;
    }
    return '';
  }

  function extractNamesFromLine(upper) {
    let rest = upper;
    rest = rest.replace(/\b\d{1,2}\b/g, ' ');
    for (const t of rest.split(/\s+/)) {
      if (fuzzyMatchWord(t, months) || fuzzyMatchWord(t, weekdays)) {
        rest = rest.replace(new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g'), ' ');
      }
    }
    return rest.split(/\s*[-–—|]+\s*|\s{2,}/)
      .map(s => s.trim())
      .filter(s => s.length > 1 && !/^\d+$/.test(s) && !stopWords.has(s));
  }

  for (const line of lines) {
    const upper = line.toUpperCase().trim();
    if (!upper) continue;

    if (upper.includes('ACOMODADOR')) { currentSection = sections[0]; lastEntry = null; continue; }
    if (upper.includes('MICROFONO') || upper.includes('MICRÓFONO')) { currentSection = sections[1]; lastEntry = null; continue; }
    if (upper.includes('PLATAFORMA')) { currentSection = sections[2]; lastEntry = null; continue; }
    if (upper.includes('SALIDAS') && upper.includes('PREDICACION') || upper.includes('PREDICACIÓN')) { currentSection = sections[3]; lastEntry = null; continue; }
    if (!currentSection) continue;

    // Special handling for salidas_predicacion section (table format)
    if (currentSection.id === 'salidas_predicacion') {
      const weekday = detectWeekday(upper);
      if (!weekday) continue;

      // Extract hour (e.g., "4:00 p.m.", "9:00 a.m.")
      const hourMatch = upper.match(/(\d{1,2}:\d{2}\s*(?:a\.m\.|p\.m\.))/i);
      const hour = hourMatch ? hourMatch[1] : '';

      // Extract modality (Presencial/Zoom)
      let modality = '';
      if (upper.includes('PRESENCIAL')) modality = 'Presencial';
      else if (upper.includes('ZOOM')) modality = 'Zoom';

      // Extract captain name (remaining text after removing day/hour/modality)
      let captainLine = upper;
      // Remove weekday names
      for (const wd of ['LUNES','MARTES','MIERCOLES','MIÉRCOLES','JUEVES','VIERNES','SABADO','SÁBADO','DOMINGO']) {
        captainLine = captainLine.replace(new RegExp('\\b' + wd + '\\b', 'g'), '');
      }
      // Remove hour patterns
      captainLine = captainLine.replace(/\d{1,2}:\d{2}\s*(?:A\.M\.|P\.M\.)/gi, '');
      // Remove modality
      captainLine = captainLine.replace(/PRESENCIAL|ZOOM/gi, '');
      // Remove common stop words and clean
      captainLine = captainLine.replace(/\bDE\b/g, '').trim();
      // Extract names
      const captainNames = captainLine.split(/\s*[-–—|]+\s*|\s{2,}/)
        .map(s => s.trim())
        .filter(s => s.length > 1 && !/^\d+$/.test(s) && !stopWords.has(s));

      if (weekday && (hour || captainNames.length > 0)) {
        const dayNum = weekday === 'LUN' ? '01' : weekday === 'MAR' ? '02' : weekday === 'MIE' ? '03' :
                       weekday === 'JUE' ? '04' : weekday === 'VIE' ? '05' : weekday === 'SAB' ? '06' : '07';
        const monthNames = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
        const month = monthNames[new Date().getMonth()];

        const newEntry = {
          day: dayNum,
          month,
          weekday,
          hour,
          modality,
          slots: captainNames.slice(0, 1) || [''],
        };
        currentSection.entries.push(newEntry);
        lastEntry = newEntry;
      }
      continue;
    }

    const month = detectMonth(upper);
    const weekday = detectWeekday(upper);
    const dayMatch = upper.match(/\b(\d{1,2})\b/);
    const dayNum = dayMatch ? dayMatch[1].padStart(2, '0') : null;

    if (!dayNum || !month) {
      const names = extractNamesFromLine(upper);
      if (names.length > 0 && lastEntry && lastEntry.slots.length === 0) {
        const maxSlots = currentSection.slotLabels.length || 1;
        lastEntry.slots = names.slice(0, Math.max(maxSlots, names.length));
      }
      continue;
    }

    const names = extractNamesFromLine(upper);
    const maxSlots = currentSection.slotLabels.length || 1;
    const newEntry = {
      day: dayNum,
      month,
      weekday,
      slots: names.slice(0, Math.max(maxSlots, names.length)),
    };
    currentSection.entries.push(newEntry);
    lastEntry = newEntry;
  }

  for (const sec of sections) {
    if (sec.entries.length > 0 && sec.entries[0].slots.length > sec.slotLabels.length) {
      sec.slotLabels = sec.entries[0].slots.map((_, i) => `Asignado ${i + 1}`);
    }
  }

  return { sections };
}

function renderAcomodadoresEditor(data, rawText) {
  const container = dom.acomodadoresEditor;
  container.innerHTML = '';

  if (rawText) {
    const debug = document.createElement('details');
    debug.className = 'ocr-raw-text';
    debug.innerHTML = `<summary style="cursor:pointer;color:var(--color-text-muted);font-size:0.8rem;margin-bottom:0.5rem">Ver texto OCR crudo (${data.sections.reduce((n,s) => n + s.entries.length, 0)} entradas detectadas)</summary><pre style="background:var(--color-bg);border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:0.75rem;font-size:0.75rem;max-height:300px;overflow:auto;white-space:pre-wrap">${rawText.replace(/</g,'&lt;')}</pre>`;
    container.appendChild(debug);
  }

  for (const section of data.sections) {
    const card = document.createElement('div');
    card.className = 'admin-section-card';
    card.innerHTML = `
      <h4 class="admin-section-title">${section.title}</h4>
      <div class="admin-section-entries" data-section="${section.id}">
        ${section.entries.map((entry, ei) => renderEntryRow(section, entry, ei)).join('')}
      </div>
      <button type="button" class="ghost-btn admin-add-entry" data-section="${section.id}" style="margin-top:0.5rem;font-size:0.85rem">+ Agregar fecha</button>
    `;
    container.appendChild(card);
  }

  container.querySelectorAll('.admin-add-entry').forEach(btn => {
    btn.addEventListener('click', () => {
      const secId = btn.dataset.section;
      const sec = data.sections.find(s => s.id === secId);
      if (!sec) return;
      sec.entries.push({ day: '', month: '', weekday: '', slots: sec.slotLabels.map(() => '') });
      renderAcomodadoresEditor(data);
    });
  });

  container.querySelectorAll('.admin-delete-entry').forEach(btn => {
    btn.addEventListener('click', () => {
      const secId = btn.dataset.section;
      const idx = parseInt(btn.dataset.index, 10);
      const sec = data.sections.find(s => s.id === secId);
      if (!sec) return;
      sec.entries.splice(idx, 1);
      renderAcomodadoresEditor(data);
    });
  });

  container.querySelectorAll('.admin-entry-field').forEach(input => {
    input.addEventListener('change', () => {
      const secId = input.dataset.section;
      const idx = parseInt(input.dataset.index, 10);
      const field = input.dataset.field;
      const slotIdx = input.dataset.slot;
      const sec = data.sections.find(s => s.id === secId);
      if (!sec || !sec.entries[idx]) return;
      if (slotIdx !== undefined) {
        sec.entries[idx].slots[parseInt(slotIdx, 10)] = input.value;
      } else {
        sec.entries[idx][field] = input.value;
      }
    });
  });
}

function renderEntryRow(section, entry, index) {
  const maxSlots = Math.max(section.slotLabels.length, entry.slots.length || 1);
  const slotInputs = Array.from({ length: maxSlots }, (_, i) => {
    const label = section.slotLabels[i] || `Asignado ${i + 1}`;
    const val = entry.slots[i] || '';
    return `<input class="admin-entry-field" data-section="${section.id}" data-index="${index}" data-slot="${i}" type="text" value="${val}" placeholder="${label}" />`;
  }).join('');

  return `
    <div class="admin-entry-row">
      <input class="admin-entry-field" data-section="${section.id}" data-index="${index}" data-field="day" type="text" value="${entry.day}" placeholder="Dia" maxlength="2" style="width:3rem" />
      <input class="admin-entry-field" data-section="${section.id}" data-index="${index}" data-field="month" type="text" value="${entry.month}" placeholder="Mes" style="width:5rem" />
      <input class="admin-entry-field" data-section="${section.id}" data-index="${index}" data-field="weekday" type="text" value="${entry.weekday}" placeholder="Día" maxlength="3" style="width:3.5rem" />
      ${slotInputs}
      <button type="button" class="admin-delete-entry danger-btn" data-section="${section.id}" data-index="${index}" style="padding:0.3rem 0.6rem;font-size:0.75rem">X</button>
    </div>
  `;
}

async function onAcomodadoresSave() {
  if (!pendingAcomodadoresData) return;
  try {
    await saveAcomodadoresData(pendingAcomodadoresData);
    dom.acomodadoresOcrResult.hidden = true;
    dom.ocrProgressText.textContent = 'Datos guardados y publicados.';
    dom.acomodadoresOcrStatus.hidden = false;
    dom.acomodadoresOcrStatus.classList.add('success');
    pendingAcomodadoresData = null;
    await renderPublicAcomodadores();
  } catch (err) {
    dom.acomodadoresUploadError.textContent = err?.message || 'No se pudo guardar.';
    dom.acomodadoresUploadError.hidden = false;
  }
}

async function onAcomodadoresClear() {
  if (!confirm('¿Borrar todos los datos de acomodadores?')) return;
  try {
    await clearAcomodadoresData();
    dom.acomodadoresOcrResult.hidden = true;
    dom.acomodadoresOcrStatus.hidden = true;
    dom.acomodadoresEditor.innerHTML = '';
    pendingAcomodadoresData = null;
    await renderPublicAcomodadores();
  } catch (err) {
    dom.acomodadoresUploadError.textContent = err?.message || 'No se pudo borrar.';
    dom.acomodadoresUploadError.hidden = false;
  }
}

async function loadAdminAcomodadoresPreview() {
  if (!firebaseConfigured()) return;
  try {
    const data = await loadAcomodadoresData();
    pendingAcomodadoresData = data;
    renderAcomodadoresEditor(data);
    dom.acomodadoresOcrResult.hidden = false;
  } catch {
    dom.acomodadoresOcrResult.hidden = true;
  }
}

const MONTHS_ES = {
  ENERO: 0, FEBRERO: 1, MARZO: 2, ABRIL: 3, MAYO: 4, JUNIO: 5,
  JULIO: 6, AGOSTO: 7, SEPTIEMBRE: 8, OCTUBRE: 9, NOVIEMBRE: 10, DICIEMBRE: 11,
};

function entryDateMs(entry, refYear) {
  const m = MONTHS_ES[entry.month];
  if (m === undefined) return null;
  const day = parseInt(entry.day, 10);
  if (!Number.isFinite(day)) return null;
  return new Date(refYear, m, day, 0, 0, 0, 0).getTime();
}

function startOfWeek(date) {
  const dow = date.getDay();
  const delta = dow === 0 ? 6 : dow - 1;
  const start = new Date(date);
  start.setDate(date.getDate() - delta);
  start.setHours(0, 0, 0, 0);
  return start;
}

function groupEntriesByWeek(entries, refYear) {
  const weeks = [];
  for (const entry of entries) {
    const ms = entryDateMs(entry, refYear);
    if (ms === null) continue;
    const startMs = startOfWeek(new Date(ms)).getTime();
    let week = weeks.find(w => w.startMs === startMs);
    if (!week) {
      week = { startMs, entries: [] };
      weeks.push(week);
    }
    week.entries.push({ entry, ms });
  }
  weeks.sort((a, b) => a.startMs - b.startMs);
  for (const w of weeks) w.entries.sort((a, b) => a.ms - b.ms);
  return weeks;
}

function findAcomodadoresWeekIndex(weeks, now = new Date()) {
  const todayMs = now.getTime();
  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    const endMs = w.startMs + 7 * 24 * 60 * 60 * 1000;
    if (todayMs >= w.startMs && todayMs < endMs) return { index: i, kind: 'current' };
  }
  for (let i = 0; i < weeks.length; i++) {
    if (todayMs < weeks[i].startMs) return { index: i, kind: 'upcoming' };
  }
  return { index: weeks.length - 1, kind: 'past' };
}

const acoState = { weeks: [], viewIndex: 0 };

async function renderPublicAcomodadores() {
  const container = dom.acomodadoresDefaultTables;
  if (!container) return;
  try {
    const data = await loadAcomodadoresData();
    const refYear = new Date().getFullYear();

    const sectionsWeeks = data.sections.map(section => ({
      ...section,
      weeks: groupEntriesByWeek(section.entries, refYear),
    }));
    const totalWeeks = sectionsWeeks.reduce((max, s) => Math.max(max, s.weeks.length), 0);
    acoState.weeks = Array.from({ length: totalWeeks }, (_, i) => i);

    const { index } = findAcomodadoresWeekIndex(
      acoState.weeks.map(i => ({ startMs: sectionsWeeks.reduce((min, s) => Math.min(min, s.weeks[i]?.startMs ?? Infinity), Infinity) })),
    );
    if (acoState.viewIndex >= totalWeeks || acoState.viewIndex < 0) acoState.viewIndex = 0;
    if (!acoState._navigated) {
      acoState.viewIndex = index >= 0 ? index : 0;
    }

    if (dom.acomodadoresNav) {
      dom.acomodadoresNav.hidden = totalWeeks <= 1;
      dom.acomodadoresPrevBtn.disabled = acoState.viewIndex <= 0;
      dom.acomodadoresNextBtn.disabled = acoState.viewIndex >= totalWeeks - 1;
      const currentWeek = sectionsWeeks[0]?.weeks[acoState.viewIndex];
      if (currentWeek) {
        const start = new Date(currentWeek.startMs);
        const end = new Date(currentWeek.startMs + 6 * 24 * 60 * 60 * 1000);
        const fmt = { day: '2-digit', month: 'short' };
        dom.acomodadoresPosition.textContent = `Semana ${acoState.viewIndex + 1} de ${totalWeeks} · ${start.toLocaleDateString('es', fmt)} – ${end.toLocaleDateString('es', fmt)}`;
      } else {
        dom.acomodadoresPosition.textContent = `Semana ${acoState.viewIndex + 1} de ${totalWeeks}`;
      }
    }

    container.innerHTML = '';

    const weekdayFull = { SAB: 'SÁBADO', MIE: 'MIÉRCOLES', JUE: 'JUEVES', VIE: 'VIERNES', LUN: 'LUNES', MAR: 'MARTES', DOM: 'DOMINGO' };
    const meetingType = { SAB: 'Reunión de fin de semana', DOM: 'Reunión de fin de semana', MIE: 'Reunión de entre semana', JUE: 'Reunión de entre semana', VIE: 'Reunión de entre semana' };
    const sectionMeta = {
      acomodadores: { icon: '👥', cls: 'sub-ac' },
      microfonos: { icon: '🎤', cls: 'sub-mic' },
      plataforma: { icon: '📋', cls: 'sub-plat' },
    };

    const dayMap = new Map();
    for (const section of sectionsWeeks) {
      const week = section.weeks[acoState.viewIndex];
      if (!week) continue;
      for (const wEntry of week.entries) {
        const entry = wEntry.entry;
        if (!dayMap.has(entry.weekday)) {
          dayMap.set(entry.weekday, { weekday: entry.weekday, dates: {}, sections: [] });
        }
        const dayData = dayMap.get(entry.weekday);
        const dateKey = `${entry.day}-${entry.month}`;
        dayData.dates[dateKey] = (dayData.dates[dateKey] || 0) + 1;
        dayData.sections.push({
          id: section.id,
          title: section.title,
          slotLabels: section.slotLabels,
          slots: entry.slots,
        });
      }
    }

    const days = [...dayMap.values()].map(d => {
      const entries = Object.entries(d.dates);
      entries.sort((a, b) => b[1] - a[1]);
      const [topDate] = entries[0] || [];
      const [day, month] = (topDate || '01-ENERO').split('-');
      return { ...d, day, month };
    });
    const dayOrder = { MIE: 0, JUE: 1, VIE: 2, SAB: 3, DOM: 4 };
    days.sort((a, b) => (dayOrder[a.weekday] ?? 9) - (dayOrder[b.weekday] ?? 9));

    if (days.length === 0) {
      container.innerHTML = '<p class="acomodadores-empty">Sin asignaciones para esta semana.</p>';
      return;
    }

    for (const day of days) {
      const card = document.createElement('div');
      card.className = 'acomodadores-day-card';
      const dayClass = day.weekday === 'SAB' ? 'day-card-sab' : 'day-card-mie';
      const fullDay = weekdayFull[day.weekday] || day.weekday;
      const meeting = meetingType[day.weekday] || '';

      card.innerHTML = `
        <div class="day-header ${dayClass}">
          <div class="day-header-left">
            <span class="day-weekday">${fullDay}</span>
            <span class="day-meeting">${meeting}</span>
          </div>
          <div class="day-date-block">
            <span class="day-num">${day.day}</span>
            <span class="day-mes">${day.month}</span>
          </div>
        </div>
        <div class="day-body">
          ${day.sections.map(sec => {
            const meta = sectionMeta[sec.id] || { icon: '•', cls: '' };
            const maxSlots = Math.max(sec.slotLabels.length, sec.slots.length);
            const pills = Array.from({ length: maxSlots }, (_, i) => {
              const label = sec.slotLabels[i] || '';
              const name = sec.slots[i] || '';
              if (!name) return '';
              const labelHtml = label ? `<span class="person-slot-label">${label}</span>` : '';
              return `<div class="person-slot">${labelHtml}<span class="person-pill">${name}</span></div>`;
            }).join('');
            return `
              <div class="day-section ${meta.cls}">
                <div class="day-section-header">
                  <span class="day-section-icon">${meta.icon}</span>
                  <span class="day-section-title">${sec.title}</span>
                </div>
                <div class="day-section-people">${pills || '<span class="day-section-empty">—</span>'}</div>
              </div>
            `;
          }).join('')}
        </div>
      `;
      container.appendChild(card);
    }
  } catch {
    container.innerHTML = '';
    if (dom.acomodadoresNav) dom.acomodadoresNav.hidden = true;
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
        .getRegistration()
        .then((existing) => {
          const hadActive = !!(existing && existing.active);
          return navigator.serviceWorker.register('./service-worker.js', { scope: './' })
            .then((registration) => ({ registration, hadActive }));
        })
        .then(({ registration, hadActive }) => {
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
                if (!hadActive) return;
                const refreshBtn = document.getElementById('refresh-btn');
                if (refreshBtn) {
                  refreshBtn.classList.add('has-update');
                  refreshBtn.title = 'Nueva versión disponible — tocar para actualizar';
                }
              }
            });
          });

          if (registration.waiting && hadActive) {
            const refreshBtn = document.getElementById('refresh-btn');
            if (refreshBtn) {
              refreshBtn.classList.add('has-update');
              refreshBtn.title = 'Nueva versión disponible — tocar para actualizar';
            }
          }
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

// ---------------------- Salidas de Predicación ----------------------

const WEEKDAY_ORDER = { LUN: 0, MAR: 1, MIE: 2, JUE: 3, VIE: 4, SAB: 5, DOM: 6 };
const WEEKDAY_FULL = { LUN: 'LUNES', MAR: 'MARTES', MIE: 'MIÉRCOLES', JUE: 'JUEVES', VIE: 'VIERNES', SAB: 'SÁBADO', DOM: 'DOMINGO' };

async function renderPublicSalidas() {
  const container = dom.salidasDefaultTables;
  if (!container) return;
  try {
    const entries = await loadSalidasData();
    if (!entries || entries.length === 0) {
      container.innerHTML = '<p class="acomodadores-empty">Sin asignaciones de predicación.</p>';
      return;
    }

    const sorted = [...entries].sort((a, b) => (WEEKDAY_ORDER[a.weekday] ?? 9) - (WEEKDAY_ORDER[b.weekday] ?? 9));

    // Group by weekday
    const grouped = new Map();
    for (const entry of sorted) {
      if (!grouped.has(entry.weekday)) grouped.set(entry.weekday, []);
      grouped.get(entry.weekday).push(entry);
    }

    const dayColors = {
      LUN: { bg: '#eff6ff', border: '#3b82f6', text: '#1e40af' },
      MAR: { bg: '#f0fdf4', border: '#22c55e', text: '#166534' },
      MIE: { bg: '#fefce8', border: '#eab308', text: '#854d0e' },
      JUE: { bg: '#fdf4ff', border: '#a855f7', text: '#6b21a8' },
      VIE: { bg: '#fff7ed', border: '#f97316', text: '#9a3412' },
      SAB: { bg: '#fef2f2', border: '#ef4444', text: '#991b1b' },
      DOM: { bg: '#f0f9ff', border: '#0ea5e9', text: '#0c4a6e' },
    };

    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'salidas-grid';

    for (const [weekday, dayEntries] of grouped) {
      const colors = dayColors[weekday] || { bg: '#f9fafb', border: '#6b7280', text: '#374151' };
      const card = document.createElement('div');
      card.className = 'salidas-day-card';
      card.style.setProperty('--day-bg', colors.bg);
      card.style.setProperty('--day-border', colors.border);
      card.style.setProperty('--day-text', colors.text);

      let entriesHtml = '';
      for (const e of dayEntries) {
        const modalityCls = e.modality === 'Zoom' ? 'modality-zoom' : 'modality-presencial';
        entriesHtml += `
          <div class="salida-entry">
            <span class="salida-hour">${e.hour || ''}</span>
            <span class="salida-modality ${modalityCls}">${e.modality || ''}</span>
            <span class="salida-captain">${e.captain || ''}</span>
          </div>
        `;
      }

      card.innerHTML = `
        <div class="salidas-day-header">
          <span class="salidas-day-name">${WEEKDAY_FULL[weekday] || weekday}</span>
        </div>
        <div class="salidas-day-entries">
          ${entriesHtml}
        </div>
      `;
      wrapper.appendChild(card);
    }
    container.appendChild(wrapper);
  } catch {
    container.innerHTML = '';
  }
}

let pendingSalidasData = null;

function renderSalidasEditor(entries) {
  const container = dom.salidasEditor;
  container.innerHTML = '';

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const row = document.createElement('div');
    row.className = 'admin-entry-row';
    row.innerHTML = `
      <input class="admin-entry-field" data-index="${i}" data-field="weekday" type="text" value="${e.weekday}" placeholder="Día" maxlength="3" style="width:4rem" />
      <input class="admin-entry-field" data-index="${i}" data-field="hour" type="text" value="${e.hour || ''}" placeholder="Hora" style="width:6rem" />
      <input class="admin-entry-field" data-index="${i}" data-field="modality" type="text" value="${e.modality || ''}" placeholder="Modalidad" style="width:6rem" />
      <input class="admin-entry-field" data-index="${i}" data-field="captain" type="text" value="${e.captain || ''}" placeholder="Capitán" style="flex:1" />
      <button type="button" class="admin-delete-entry danger-btn" data-index="${i}" style="padding:0.3rem 0.6rem;font-size:0.75rem">X</button>
    `;
    container.appendChild(row);
  }

  container.querySelectorAll('.admin-delete-entry').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index, 10);
      entries.splice(idx, 1);
      renderSalidasEditor(entries);
    });
  });

  container.querySelectorAll('.admin-entry-field').forEach(input => {
    input.addEventListener('change', () => {
      const idx = parseInt(input.dataset.index, 10);
      const field = input.dataset.field;
      entries[idx][field] = input.value;
    });
  });
}

function parseSalidasText(lines) {
  const weekdays = ['LUNES','MARTES','MIERCOLES','MIÉRCOLES','JUEVES','VIERNES','SABADO','SÁBADO','DOMINGO'];
  const weekdayToCode = { LUNES:'LUN', MARTES:'MAR', MIERCOLES:'MIE', MIÉRCOLES:'MIE', JUEVES:'JUE', VIERNES:'VIE', SABADO:'SAB', SÁBADO:'SAB', DOMINGO:'DOM' };

  const entries = [];
  for (const line of lines) {
    const upper = line.toUpperCase().trim();
    if (!upper) continue;

    let matchedDay = null;
    for (const wd of weekdays) {
      if (upper.includes(wd)) { matchedDay = wd; break; }
    }
    if (!matchedDay) continue;

    const hourMatch = upper.match(/(\d{1,2}:\d{2}\s*(?:A\.M\.|P\.M\.))/i);
    const hour = hourMatch ? hourMatch[1] : '';

    let modality = '';
    if (upper.includes('PRESENCIAL')) modality = 'Presencial';
    else if (upper.includes('ZOOM')) modality = 'Zoom';

    let captainLine = upper;
    for (const wd of weekdays) captainLine = captainLine.replace(new RegExp('\\b' + wd + '\\b', 'g'), '');
    captainLine = captainLine.replace(/\d{1,2}:\d{2}\s*(?:A\.M\.|P\.M\.)/gi, '');
    captainLine = captainLine.replace(/PRESENCIAL|ZOOM/gi, '');
    captainLine = captainLine.replace(/\bDE\b/g, '').trim();
    const captain = captainLine.split(/\s*[-–—|]+\s*|\s{2,}/)
      .map(s => s.trim())
      .filter(s => s.length > 1 && !/^\d+$/.test(s))
      .join(' ')
      .trim();

    if (matchedDay) {
      entries.push({
        weekday: weekdayToCode[matchedDay],
        hour,
        modality,
        captain: captain || '',
      });
    }
  }
  return entries;
}

async function onSalidasUpload(e) {
  e.preventDefault();
  dom.salidasUploadError.hidden = true;
  dom.salidasOcrStatus.hidden = false;
  dom.salidasOcrProgressText.textContent = 'Leyendo PDF...';

  const file = dom.salidasFileInput.files?.[0];
  if (!file) {
    dom.salidasUploadError.textContent = 'Seleccione un archivo PDF.';
    dom.salidasUploadError.hidden = false;
    dom.salidasOcrStatus.hidden = true;
    return;
  }

  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;

    const allLines = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      dom.salidasOcrProgressText.textContent = `Leyendo página ${p} de ${pdf.numPages}...`;
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const buckets = new Map();
      for (const item of content.items) {
        if (!item.str || !item.transform) continue;
        const x = item.transform[4];
        const y = item.transform[5];
        const key = Math.round(y);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push({ x, str: item.str });
      }
      const sortedKeys = [...buckets.keys()].sort((a, b) => b - a);
      const merged = [];
      for (const k of sortedKeys) {
        if (merged.length && Math.abs(merged[merged.length - 1].key - k) <= 3) {
          merged[merged.length - 1].items.push(...buckets.get(k));
        } else {
          merged.push({ key: k, items: [...buckets.get(k)] });
        }
      }
      for (const row of merged) {
        row.items.sort((a, b) => a.x - b.x);
        const line = row.items.map(it => it.str).join('  ').trim();
        if (line) allLines.push(line);
      }
    }

    const rawText = allLines.join('\n');
    const parsed = parseSalidasText(allLines);
    pendingSalidasData = parsed;
    renderSalidasEditor(parsed);
    dom.salidasOcrStatus.hidden = true;
    dom.salidasOcrResult.hidden = false;
  } catch (err) {
    console.error(err);
    dom.salidasUploadError.textContent = 'No se pudo leer el PDF. Intente con otro archivo.';
    dom.salidasUploadError.hidden = false;
    dom.salidasOcrStatus.hidden = true;
  }
}

async function onSalidasSave() {
  if (!pendingSalidasData) return;
  try {
    await saveSalidasData(pendingSalidasData);
    dom.salidasOcrResult.hidden = true;
    dom.salidasOcrProgressText.textContent = 'Datos guardados y publicados.';
    dom.salidasOcrStatus.hidden = false;
    dom.salidasOcrStatus.classList.add('success');
    pendingSalidasData = null;
    await renderPublicSalidas();
  } catch (err) {
    dom.salidasUploadError.textContent = err?.message || 'No se pudo guardar.';
    dom.salidasUploadError.hidden = false;
  }
}

async function onSalidasClear() {
  if (!confirm('¿Borrar todos los datos de salidas de predicación?')) return;
  try {
    await clearSalidasData();
    dom.salidasOcrResult.hidden = true;
    dom.salidasOcrStatus.hidden = true;
    dom.salidasEditor.innerHTML = '';
    pendingSalidasData = null;
    await renderPublicSalidas();
  } catch (err) {
    dom.salidasUploadError.textContent = err?.message || 'No se pudo borrar.';
    dom.salidasUploadError.hidden = false;
  }
}

async function loadAdminSalidasPreview() {
  if (!firebaseConfigured()) return;
  try {
    const entries = await loadSalidasData();
    pendingSalidasData = entries;
    renderSalidasEditor(entries);
    dom.salidasOcrResult.hidden = false;
  } catch {
    dom.salidasOcrResult.hidden = true;
  }
}

init().catch((err) => {
  console.error('Init failed', err);
  try {
    if (dom.statusBar) dom.statusBar.textContent = 'Ocurrió un error iniciando la aplicación. Toque el botón de actualizar.';
  } catch {}
});
