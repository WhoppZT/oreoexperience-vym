// Parses a PDF (typically "Vida y Ministerio Cristianos" weekly program) into
// a structured list of weeks. Uses pdf.js loaded as a module.

import * as pdfjsLib from '../vendor/pdf.min.mjs';

// Tell pdf.js where to find its worker file (must be relative to this page,
// so we use an absolute URL built from the current location).
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

const MONTHS = {
  ENERO: 0,
  FEBRERO: 1,
  MARZO: 2,
  ABRIL: 3,
  MAYO: 4,
  JUNIO: 5,
  JULIO: 6,
  AGOSTO: 7,
  SEPTIEMBRE: 8,
  SETIEMBRE: 8,
  OCTUBRE: 9,
  NOVIEMBRE: 10,
  DICIEMBRE: 11,
};

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

const DATE_RE = new RegExp(
  // start day
  '(\\d{1,2})\\s*' +
    // separator: en/em dash, hyphen or " A "
    '(?:[\u2013\u2014\\-]|\\bA\\b|\\ba\\b)' +
    '\\s*(\\d{1,2})\\s+' +
    // optional "DE"
    '(?:DE\\s+)?' +
    '(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)',
  'i',
);

const SECTION_DEFS = [
  { id: 'tesoros', label: 'Tesoros de la Biblia', match: /TESOROS\s+DE\s+LA\s+BIBLIA/i },
  { id: 'maestros', label: 'Seamos Mejores Maestros', match: /SEAMOS\s+MEJORES\s+MAESTROS/i },
  { id: 'cristiana', label: 'Nuestra Vida Cristiana', match: /NUESTRA\s+VIDA\s+CRISTIANA/i },
];

const NOISE_LINES = [
  /^Programa para la reuni[oó]n de entre semana$/i,
  /^LOMAS DE BOLIVAR$/i,
  /^Auditorio principal$/i,
  /^S-140-S\b/i,
];

function normalize(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function isNoise(line) {
  const t = line.trim();
  if (!t) return true;
  return NOISE_LINES.some((re) => re.test(t));
}

async function pageToLines(page) {
  const content = await page.getTextContent();
  const buckets = new Map();
  for (const item of content.items) {
    if (!item.str || !item.transform) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    const width = typeof item.width === 'number' ? item.width : item.str.length * 4;
    const fontHeight = Math.abs(item.transform[3]) || 10;
    // Bucket by rounded Y so items on the same row group together.
    const key = Math.round(y);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({ x, y, width, str: item.str, fontHeight });
  }
  // Merge adjacent Y buckets (within half a font-height) into a single line.
  const sortedKeys = [...buckets.keys()].sort((a, b) => b - a);
  const merged = [];
  for (const k of sortedKeys) {
    if (merged.length && Math.abs(merged[merged.length - 1].key - k) <= 3) {
      merged[merged.length - 1].items.push(...buckets.get(k));
    } else {
      merged.push({ key: k, items: [...buckets.get(k)] });
    }
  }
  return merged
    .map((row) => {
      row.items.sort((a, b) => a.x - b.x);
      let line = '';
      let prevEnd = -Infinity;
      let prevFontHeight = 10;
      for (const it of row.items) {
        if (!it.str) continue;
        const gap = it.x - prevEnd;
        if (line.length === 0) {
          line = it.str;
        } else {
          // Decide how to join based on horizontal gap relative to font height.
          // Small gap → glue (PDF often splits "25" into "2" and "5" items
          // that are visually touching). Medium gap → single space.
          // Large gap → double space (used as section/column separator).
          const heightRef = Math.max(prevFontHeight, it.fontHeight, 1);
          if (gap < heightRef * 0.25 && !line.endsWith(' ') && !it.str.startsWith(' ')) {
            line += it.str;
          } else if (gap > heightRef * 1.5) {
            line += '  ' + it.str;
          } else if (line.endsWith(' ') || it.str.startsWith(' ')) {
            line += it.str;
          } else {
            line += ' ' + it.str;
          }
        }
        prevEnd = it.x + it.width;
        prevFontHeight = it.fontHeight;
      }
      return normalize(line);
    })
    .filter((line) => line.length > 0);
}

function tryParseYearFromFilename(filename) {
  if (!filename) return null;
  const m = filename.match(/(20\d{2})/);
  return m ? Number(m[1]) : null;
}

function tryParseYearFromLines(lines) {
  for (const line of lines) {
    const m = line.match(/\b(20\d{2})\b/);
    if (m) return Number(m[1]);
  }
  return null;
}

function makeDate(year, month, day) {
  // Local midnight to avoid timezone surprises.
  const d = new Date(year, month, day, 0, 0, 0, 0);
  return d;
}

function formatHumanDateRange(startDay, endDay, month, year) {
  const monthName = MONTH_NAMES_ES[month];
  // If start and end are in different months, we don't know — assume same month.
  return `${startDay} a ${endDay} de ${monthName} de ${year}`;
}

function findDateMatches(lines) {
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(DATE_RE);
    if (m) {
      const startDay = Number(m[1]);
      const endDay = Number(m[2]);
      const month = MONTHS[m[3].toUpperCase()];
      if (Number.isFinite(startDay) && Number.isFinite(endDay) && month !== undefined) {
        // Capture optional bible reading after a dash on the same line. Stop at
        // the double-space separator that the PDF uses to flow into the
        // "Presidente:" column on the right.
        const afterMatch = lines[i].slice(m.index + m[0].length);
        let bible = '';
        const bibleMatch = afterMatch.match(
          /[\u2013\u2014\-:]\s*([^\s].*?)(?=\s{2,}|\s+Presidente\b|\s+Auditorio\b|$)/i,
        );
        if (bibleMatch) bible = bibleMatch[1].trim();
        // If no bible on the same line, peek at the next line — it may hold
        // the bible reading alone or alongside the "Presidente:" column. Cut
        // at the first double-space or reserved-word column break.
        if (!bible && i + 1 < lines.length) {
          const next = lines[i + 1].trim();
          if (
            next &&
            !DATE_RE.test(next) &&
            !SECTION_DEFS.some((s) => s.match.test(next))
          ) {
            const candidate = next
              .split(/\s{2,}|\s+Presidente\b|\s+Consejero\b|\s+Auditorio\b/i)[0]
              .trim();
            if (
              candidate &&
              candidate.length < 60 &&
              /^[A-ZÁÉÍÓÚÑa-záéíóúñ0-9\s,.\-–]+$/.test(candidate) &&
              !/^(Canci[óo]n|Palabras|Oraci[óo]n|Estudiante|Ayudante)/i.test(candidate)
            ) {
              bible = candidate;
            }
          }
        }
        found.push({ lineIdx: i, startDay, endDay, month, bible });
      }
    }
  }
  return found;
}

function splitIntoWeeks(lines, year) {
  const matches = findDateMatches(lines);
  if (matches.length === 0) return [];

  const weeks = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = matches[i + 1];
    const startLine = cur.lineIdx;
    const endLine = next ? next.lineIdx : lines.length;
    const block = lines.slice(startLine, endLine).filter((l) => !isNoise(l));

    const startDate = makeDate(year, cur.month, cur.startDay);
    let endDate = makeDate(year, cur.month, cur.endDay);
    if (endDate < startDate) {
      // crosses a month boundary — assume next month
      endDate = makeDate(year, cur.month + 1, cur.endDay);
    }

    // Extract Presidente / Consejero from anywhere inside the week block
    // before we filter those lines out of the rendered Apertura.
    let presidente = '';
    let consejero = '';
    for (const raw of block) {
      const presMatch = raw.match(/Presidente\s*[:\.]\s*\[?\s*([^\]\n]+?)\s*\]?(?:\s{2,}|$)/i);
      const consMatch = raw.match(/Consejero[^:]*[:\.]\s*\[?\s*([^\]\n]+?)\s*\]?(?:\s{2,}|$)/i);
      if (!presidente && presMatch) presidente = presMatch[1].trim();
      if (!consejero && consMatch) consejero = consMatch[1].trim();
    }

    weeks.push({
      id: `${year}-${String(cur.month + 1).padStart(2, '0')}-${String(cur.startDay).padStart(2, '0')}`,
      startMs: startDate.getTime(),
      endMs: endDate.getTime() + 24 * 60 * 60 * 1000 - 1, // inclusive of last day
      startDay: cur.startDay,
      endDay: cur.endDay,
      month: cur.month,
      year,
      headerLine: lines[cur.lineIdx],
      humanDate: formatHumanDateRange(cur.startDay, cur.endDay, cur.month, year),
      bible: cur.bible,
      presidente,
      consejero,
      sections: buildSections(block),
      raw: block.join('\n'),
    });
  }
  return weeks;
}

function buildSections(block) {
  // Find boundaries of known sections inside the week block.
  const positions = SECTION_DEFS.map((s) => ({
    ...s,
    idx: block.findIndex((line) => s.match.test(line)),
  })).filter((s) => s.idx >= 0);
  positions.sort((a, b) => a.idx - b.idx);

  const result = [];

  // Apertura = everything before the first known section (skipping the date
  // line itself). Drop Presidente/Consejero rows since those are surfaced in
  // the week-header meta line.
  const firstSectionIdx = positions.length ? positions[0].idx : block.length;
  const opening = block
    .slice(1, firstSectionIdx)
    .filter((l) => {
      const t = l.trim();
      if (!t) return false;
      if (/^Presidente\s*[:\.]/i.test(t)) return false;
      if (/^Consejero\b/i.test(t)) return false;
      return true;
    });
  if (opening.length) {
    result.push({ id: 'apertura', label: 'Apertura', lines: opening });
  }

  for (let i = 0; i < positions.length; i++) {
    const sec = positions[i];
    const next = positions[i + 1];
    const sectionLines = block.slice(sec.idx + 1, next ? next.idx : block.length);
    result.push({
      id: sec.id,
      label: sec.label,
      lines: sectionLines.filter((l) => l.trim().length > 0),
    });
  }

  // Try to detect closing items at the end of the last section.
  if (result.length) {
    const last = result[result.length - 1];
    const closingIdx = last.lines.findIndex((l) =>
      /palabras\s+de\s+conclusi[oó]n|conclusion\s+\d|oraci[oó]n\s*[:.-]/i.test(l),
    );
    if (closingIdx > 0) {
      const closing = last.lines.slice(closingIdx);
      last.lines = last.lines.slice(0, closingIdx);
      result.push({ id: 'cierre', label: 'Conclusión', lines: closing });
    }
  }

  return result;
}

export async function parsePdfFile(file, { yearOverride } = {}) {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer.slice(0) });
  const pdf = await loadingTask.promise;

  const allLines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const pageLines = await pageToLines(page);
    allLines.push(...pageLines);
  }

  const year =
    yearOverride && Number.isFinite(yearOverride)
      ? yearOverride
      : tryParseYearFromLines(allLines) ||
        tryParseYearFromFilename(file.name) ||
        new Date().getFullYear();

  const weeks = splitIntoWeeks(allLines, year);

  return {
    weeks,
    year,
    pageCount: pdf.numPages,
    rawLines: allLines,
    detectedYearSource: yearOverride
      ? 'manual'
      : tryParseYearFromLines(allLines)
      ? 'document'
      : tryParseYearFromFilename(file.name)
      ? 'filename'
      : 'current',
    fileName: file.name,
    sizeBytes: file.size,
  };
}
