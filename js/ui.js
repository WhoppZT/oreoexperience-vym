// Renders the week card and helper components.

const MONTH_NAMES_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

const DAY_NAMES_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function capitalize(text) {
  if (!text) return text;
  return text[0].toUpperCase() + text.slice(1);
}

export function formatTodayLabel(now = new Date()) {
  const day = DAY_NAMES_ES[now.getDay()];
  const dayNum = now.getDate();
  const month = MONTH_NAMES_ES[now.getMonth()];
  const year = now.getFullYear();
  return `Hoy es ${capitalize(day)}, ${dayNum} de ${month} de ${year}`;
}

export function findCurrentWeekIndex(weeks, now = new Date()) {
  const t = now.getTime();
  // 1) Exact match: today falls inside a week
  for (let i = 0; i < weeks.length; i++) {
    if (t >= weeks[i].startMs && t <= weeks[i].endMs) return { index: i, kind: 'current' };
  }
  // 2) Upcoming: first week that hasn't started yet
  for (let i = 0; i < weeks.length; i++) {
    if (t < weeks[i].startMs) return { index: i, kind: 'upcoming' };
  }
  // 3) All weeks are past — waiting for update
  return { index: -1, kind: 'past' };
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Strip leading PDF noise: the "0:00" time prefix and stray bullets/dashes.
function stripTimePrefix(line) {
  let s = line;
  while (true) {
    const next = s
      .replace(/^\s*0:00\s*[•·\-]?\s*/, '')
      .replace(/^\s*[•·]\s+/, '')
      .trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

function applyRoleNames(line, roleNames = {}) {
  let s = line;
  for (const [role, name] of Object.entries(roleNames)) {
    if (!name) continue;
    const re = new RegExp(`\\[\\s*${escapeRegex(role)}\\s*\\]`, 'gi');
    s = s.replace(re, `[${name}]`);
  }
  return s;
}

// Split a line that crams multiple items together ("Canción 18 Oración: Carlos R"
// or "Palabras de conclusión (3 min.) cancion 71 ORACION Ivan") at the keyword
// boundaries so every item ends up on its own row.
function splitCombinedLines(line) {
  const KEYS = /(\bcanci[oó]n\b\s*:?|\boraci[oó]n\b\s*:?|\bpalabras de [\wáéíóúñ]+|\bconclusi[oó]n\b)/gi;
  const positions = [];
  let m;
  while ((m = KEYS.exec(line)) !== null) positions.push(m.index);
  if (positions.length <= 1) return [line];
  const pieces = [];
  if (positions[0] > 0) {
    const prefix = line.slice(0, positions[0]).trim();
    if (prefix) pieces.push(prefix);
  }
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i];
    const end = i + 1 < positions.length ? positions[i + 1] : line.length;
    pieces.push(line.slice(start, end).trim());
  }
  return pieces.filter(Boolean);
}

// Pull a person name out of "Algo [Nombre]" returning { text, persons }.
function extractPersons(line) {
  // Inline numeric-only brackets first (e.g. "Canción [24]" → "Canción 24").
  const inlined = line.replace(/\[\s*([\d,.\s\-/]+)\s*\]/g, '$1');
  const persons = [];
  const re = /\[([^\]]+)\]/g;
  let match;
  while ((match = re.exec(inlined)) !== null) {
    const v = match[1].trim();
    if (v) persons.push(titleCaseName(v));
  }
  const text = inlined.replace(/\[[^\]]+\]/g, '').replace(/\s{2,}/g, ' ').trim();
  return { text, persons };
}

// Title-case a person's name ("ISIDRO URBINA" → "Isidro Urbina",
// "Juan c Jaimes" → "Juan C Jaimes").
function titleCaseName(raw) {
  const s = String(raw).trim();
  if (!s) return s;
  return s
    .toLowerCase()
    .replace(/(^|\s|\/|-|\.)(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase())
    .replace(/\s+/g, ' ');
}

// Normalize keyword spellings/capitalization (cancion → "Canción ",
// ORACIÓN → "Oración: "). Replacements keep a trailing space so the
// following number/name isn't glued to the keyword.
function normalizeKeywords(text) {
  let s = text;
  s = s.replace(/\bcanci[oó]n\b\s*:?\s*/i, 'Canción ');
  s = s.replace(/\boraci[oó]n\b\s*:?\s*/i, 'Oración: ');
  s = s.replace(/\bconclusi[oó]n\b/i, 'Conclusión');
  s = s.replace(/\s{2,}/g, ' ').trim();
  if (s) s = s[0].toUpperCase() + s.slice(1);
  return s;
}

// Clean up parser oddities (double numbering, double spaces, etc.).
function polishText(text) {
  let s = text;
  // "7. 8. Title" → "8. Title"
  s = s.replace(/^(\d+\.\s+)(\d+\.\s+)/, '$2');
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s;
}

// Drop lines that obviously aren't an assignment (PDF headers / footers that
// leaked into a section, empty bullets, lone role labels, etc.).
function isGarbageLine(line) {
  const s = (line || '').trim();
  if (!s) return true;
  if (s.length < 2) return true;
  if (/^[•·\-:;\s]+$/.test(s)) return true;
  // "JEREMIAS 4 - 6 Presidente: ..." — bible-book header that leaked into a section.
  if (/^[A-ZÁÉÍÓÚÜÑ\s]+\d+\s*[-–]\s*\d+\s+Presidente\b/i.test(s)) return true;
  // Congregation/program headers ("LOMAS DE BOLIVAR Programa para...")
  if (/^[A-ZÁÉÍÓÚÜÑ\s]{4,}\s+(Programa|Reuni[oó]n)\b/i.test(s)) return true;
  // Stray role labels alone
  if (/^Estudiante\s*\/?\s*Ayudante:?$/i.test(s)) return true;
  return false;
}

// If a piece is something like "Oración: Carlos R" or "ORACIÓN ISIDRO URBINA"
// without brackets, pull the trailing name out as the responsible person.
function extractInlinePerson(text) {
  const m = text.match(/^(oraci[oó]n)\b\s*:?\s*(.+)$/i);
  if (m && m[2].trim()) {
    return { text: 'Oración:', persons: [titleCaseName(m[2].trim())] };
  }
  return null;
}

function renderAssignmentLines(lines, roleNames = {}) {
  const rows = [];
  for (const raw of lines) {
    const stripped = stripTimePrefix(raw);
    if (!stripped) continue;
    if (isGarbageLine(stripped)) continue;
    const withRoles = applyRoleNames(stripped, roleNames);
    for (const piece of splitCombinedLines(withRoles)) {
      let { text, persons } = extractPersons(piece);
      text = normalizeKeywords(text);
      if (!persons.length) {
        const inline = extractInlinePerson(text);
        if (inline) {
          text = inline.text;
          persons = inline.persons;
        }
      }
      text = polishText(text);
      if (isGarbageLine(text) && !persons.length) continue;
      if (!text && !persons.length) continue;
      rows.push({ text, persons });
    }
  }

  if (!rows.length) return '';

  return rows
    .map(({ text, persons }) => {
      const personHtml = persons.length
        ? `<div class="assignment-person">${escapeHtml(persons.join(' · '))}</div>`
        : '';
      return `
        <div class="assignment-row${persons.length ? '' : ' assignment-row--no-person'}">
          <div class="assignment-line">${escapeHtml(text)}</div>
          ${personHtml}
        </div>
      `;
    })
    .join('');
}

export function renderWeek(week, { container, label }) {
  if (!container) return;

  container.querySelector('#week-label').textContent = label || '';
  container.querySelector('#week-title').textContent = week.humanDate;
  const bibleEl = container.querySelector('#week-bible');
  if (week.bible) {
    bibleEl.textContent = `Lectura: ${week.bible}`;
    bibleEl.hidden = false;
  } else {
    bibleEl.textContent = '';
    bibleEl.hidden = true;
  }

  const roleNames = {
    Presidente: week.presidente,
    Consejero: week.consejero,
  };

  // Display roles as a small grid in the header (label : value).
  const metaEl = container.querySelector('#week-meta');
  metaEl.innerHTML = '';
  const headerRoles = [
    ['Presidente', week.presidente],
    ['Consejero', week.consejero],
  ].filter(([, v]) => !!v);
  if (headerRoles.length) {
    metaEl.className = 'week-meta roles-grid';
    metaEl.innerHTML = headerRoles
      .map(
        ([k, v]) => `
        <div class="role-cell">
          <span class="role-label">${escapeHtml(k)}</span>
          <span class="role-value">${escapeHtml(v)}</span>
        </div>
      `,
      )
      .join('');
  } else {
    metaEl.className = 'week-meta';
  }

  const sectionsHost = container.querySelector('#week-sections');
  sectionsHost.innerHTML = '';
  for (const sec of week.sections) {
    const block = document.createElement('div');
    block.className = 'section-block';
    block.innerHTML = `
      <h3 class="section-heading ${sec.id}">${escapeHtml(sec.label)}</h3>
      <div class="section-body">${renderAssignmentLines(sec.lines, roleNames)}</div>
    `;
    sectionsHost.appendChild(block);
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
