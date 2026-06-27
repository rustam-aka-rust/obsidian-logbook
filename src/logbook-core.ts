// ---------------------------------------------------------------------------
// Чистая логика формата logbook-файла — без зависимости от Obsidian,
// чтобы её можно было тестировать отдельно (см. TASKS.md, раздел 2).
// ---------------------------------------------------------------------------

/** Канонический порядок колонок (язык подставляется при записи). */
export const COLS_DEFAULT = ["Start", "Stop", "Dur", "Category", "Activity", "Src"];

/** Строит строку-шапку таблицы из подписей колонок. */
export function makeTableHeader(cols: string[] = COLS_DEFAULT): string {
  return "| " + cols.join(" | ") + " |";
}

export const TABLE_HEADER = makeTableHeader();
export const TABLE_SEP = "| --- | --- | --- | --- | --- | --- |";

/** CSS-класс заметки (frontmatter `cssclasses`), под который заточен styles.css. */
export const CSS_CLASS = "logbook";
/** Тип callout'а, в который пишется дневной Total. */
export const TOTAL_CALLOUT = "logbook-total";

/** Пометки источника строки в колонке «Ист.». */
export const SRC_TIMER = "▶"; // намерял секундомером
export const SRC_DAILY = "📓"; // собрано из дейлика

/** Одна строка таблицы logbook. */
export interface LogRow {
  start: string;
  end: string;
  dur: string;
  category: string;
  activity: string;
  src: string;
}

/** Часы:минуты:секунды — для живого секундомера в статусбаре. */
export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Человекочитаемая длительность «Xh Ym Zs» (нулевые ведущие единицы опускаются). */
export function formatHuman(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || parts.length === 0) parts.push(`${s}s`);
  return parts.join(" ");
}

/**
 * Разбирает длительность из ячейки обратно в мс. Терпим к формату:
 * «Xh Ym Zs», «H:MM:SS» и старый «H:MM». Непонятное → 0.
 */
export function parseDurationToMs(raw: string): number {
  const s = (raw ?? "").trim();
  if (!s) return 0;
  const clock = s.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (clock) {
    const h = +clock[1];
    const m = +clock[2];
    const sec = clock[3] ? +clock[3] : 0;
    return ((h * 60 + m) * 60 + sec) * 1000;
  }
  let ms = 0;
  let matched = false;
  const re = /(\d+)\s*([hmsчмс])/giu;
  let mt: RegExpExecArray | null;
  while ((mt = re.exec(s)) !== null) {
    matched = true;
    const n = +mt[1];
    const u = mt[2].toLowerCase();
    if (u === "h" || u === "ч") ms += n * 3600000;
    else if (u === "m" || u === "м") ms += n * 60000;
    else ms += n * 1000; // s / с
  }
  return matched ? ms : 0;
}

/** Возвращает границы секции дня [start, end) по индексам строк (или null). */
function sectionRange(
  lines: string[],
  dateHeading: string,
): { headingIdx: number; end: number } | null {
  const headingIdx = lines.findIndex((l) => l.trim() === dateHeading);
  if (headingIdx === -1) return null;
  let end = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  return { headingIdx, end };
}

/** Сумма длительностей всех строк таблицы внутри секции дня, в мс. */
export function dayTotalMs(content: string, dateHeading: string): number {
  const lines = content.split("\n");
  const range = sectionRange(lines, dateHeading);
  if (!range) return 0;
  let ms = 0;
  for (let i = range.headingIdx + 1; i < range.end; i++) {
    const l = lines[i];
    if (!l.trim().startsWith("|")) continue;
    const cells = l.split("|"); // ["", " Старт ", " Стоп ", " Длит ", ...]
    ms += parseDurationToMs(cells[3] ?? "");
  }
  return ms;
}

/**
 * Вставляет/обновляет дневной Total (callout) сразу под заголовком дня.
 * Если callout уже есть — переписывает его текст, иначе добавляет.
 */
export function upsertDayTotal(
  content: string,
  dateHeading: string,
  totalText: string,
): string {
  const lines = content.split("\n");
  const range = sectionRange(lines, dateHeading);
  if (!range) return content;
  const totalLine = `> [!${TOTAL_CALLOUT}] ${totalText}`;
  for (let i = range.headingIdx + 1; i < range.end; i++) {
    if (lines[i].trim().startsWith(`> [!${TOTAL_CALLOUT}]`)) {
      lines[i] = totalLine;
      return lines.join("\n");
    }
  }
  lines.splice(range.headingIdx + 1, 0, "", totalLine);
  return lines.join("\n");
}

/**
 * Гарантирует, что у заметки есть `cssclasses: [logbook]` во frontmatter —
 * чтобы styles.css применялся только к TimeLog-файлам.
 */
export function ensureCssClass(content: string, cls = CSS_CLASS): string {
  if (!content.startsWith("---\n")) {
    return (
      `---\ncssclasses:\n  - ${cls}\n---\n\n` + content.replace(/^\n+/, "")
    );
  }
  const lines = content.split("\n");
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      close = i;
      break;
    }
  }
  if (close === -1) return content; // битый frontmatter — не трогаем
  const fm = lines.slice(1, close);
  if (fm.some((l) => l.includes(cls))) return content;
  const idx = fm.findIndex((l) => /^cssclasses\s*:/.test(l.trim()));
  if (idx !== -1) fm.splice(idx + 1, 0, `  - ${cls}`);
  else fm.unshift("cssclasses:", `  - ${cls}`);
  return ["---", ...fm, "---", ...lines.slice(close + 1)].join("\n");
}

// ---------------------------------------------------------------------------
// Сбор времени из дейликов (harvest)
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** «14:01» → минуты от полуночи, или null. */
function clockToMin(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = +m[1];
  const mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

function minToClock(min: number): string {
  return `${pad2(Math.floor(min / 60) % 24)}:${pad2(min % 60)}`;
}

/** Первые `maxWords` слов; «…» если обрезали (хвостовая пунктуация снимается). */
export function formatActivityLabel(text: string, maxWords = 7): string {
  const words = (text ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length <= maxWords) return words.join(" ");
  const head = words
    .slice(0, maxWords)
    .join(" ")
    .replace(/[.,;:!?—–-]+$/, "");
  return head + "…";
}

/** Текст описания после маркера: снимаем ведущие разделители (`-- `, `: `, `> `…). */
function descAfterMarker(line: string, idx: number): string {
  return line.slice(idx).replace(/^[\s\-–—:>*]+/, "").trim();
}

/**
 * Достаёт из текста дейлика строки времени по маркерам:
 * - `[14:01 - 15:06] описание` → интервал (старт/стоп/длительность);
 * - `[20m] описание` → только длительность (старт/стоп пустые).
 * Срабатывает только если внутри скобок — время по форме, и за `]` не идёт `(`
 * (чтобы не цеплять `[[вики]]`, `[текст](ссылку)` и заголовки `### 09:00 - 12:00`).
 * Один маркер на строку. Все строки помечаются источником 📓.
 */
export function parseDailyMarkers(content: string, maxWords = 7): LogRow[] {
  const rows: LogRow[] = [];
  const bracket = /\[([^[\]]+?)\]/g;
  for (const line of content.split("\n")) {
    bracket.lastIndex = 0;
    let mt: RegExpExecArray | null;
    while ((mt = bracket.exec(line)) !== null) {
      const inner = mt[1];
      const tailIdx = mt.index + mt[0].length;
      if (line[tailIdx] === "(") continue; // markdown-ссылка

      const iv = /^\s*(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})\s*$/.exec(inner);
      if (iv) {
        const a = clockToMin(iv[1]);
        const b = clockToMin(iv[2]);
        if (a === null || b === null) continue;
        const dur = (b >= a ? b - a : b + 1440 - a) * 60000;
        rows.push({
          start: minToClock(a),
          end: minToClock(b),
          dur: formatHuman(dur),
          category: "",
          activity: formatActivityLabel(descAfterMarker(line, tailIdx), maxWords),
          src: SRC_DAILY,
        });
        break;
      }

      if (/^\s*(\d+\s*[hmsчмс]\s*)+$/iu.test(inner)) {
        const dur = parseDurationToMs(inner);
        if (dur <= 0) continue;
        rows.push({
          start: "",
          end: "",
          dur: formatHuman(dur),
          category: "",
          activity: formatActivityLabel(descAfterMarker(line, tailIdx), maxWords),
          src: SRC_DAILY,
        });
        break;
      }
    }
  }
  return rows;
}

/** Рендер строки таблицы (содержимое ячеек экранируется). */
export function renderRow(r: LogRow): string {
  return `| ${r.start} | ${r.end} | ${r.dur} | ${cell(r.category)} | ${cell(
    r.activity,
  )} | ${r.src} |`;
}

/** Является ли строка сепаратором таблицы (`|---|---|`), независимо от языка. */
function isSeparatorRow(line: string): boolean {
  return (
    line.trim().startsWith("|") && line.replace(/[\s|:\-–—]/g, "") === ""
  );
}

/**
 * Разбирает строки данных таблицы внутри секции дня. Шапку находим по структуре
 * (строка прямо над сепаратором), а не по тексту — поэтому язык колонок и старые
 * файлы не важны.
 */
export function parseRowsInSection(content: string, dateHeading: string): LogRow[] {
  const lines = content.split("\n");
  const range = sectionRange(lines, dateHeading);
  if (!range) return [];
  const rows: LogRow[] = [];
  for (let i = range.headingIdx + 1; i < range.end; i++) {
    const line = lines[i];
    if (!line.trim().startsWith("|")) continue;
    if (isSeparatorRow(line)) continue; // сепаратор
    if (i + 1 < range.end && isSeparatorRow(lines[i + 1])) continue; // шапка
    const cells = line.split("|");
    rows.push({
      start: (cells[1] ?? "").trim(),
      end: (cells[2] ?? "").trim(),
      dur: (cells[3] ?? "").trim(),
      category: (cells[4] ?? "").trim(),
      activity: (cells[5] ?? "").trim(),
      src: (cells[6] ?? "").trim(),
    });
  }
  return rows;
}

/** Стабильная сортировка по времени старта; строки без старта — в конец. */
function sortRows(rows: LogRow[]): LogRow[] {
  return rows
    .map((r, i): [LogRow, number] => [r, i])
    .sort((x, y) => {
      const a = clockToMin(x[0].start);
      const b = clockToMin(y[0].start);
      const av = a === null ? Infinity : a;
      const bv = b === null ? Infinity : b;
      return av !== bv ? av - bv : x[1] - y[1];
    })
    .map((p) => p[0]);
}

/**
 * Сливает собранные из дейлика строки в секцию дня TimeLog:
 * существующие строки 📓 заменяются свежими, строки ▶ (и прочие) сохраняются,
 * день сортируется по времени старта, Total пересчитывается. Идемпотентно.
 */
export function syncDayFromDaily(
  content: string,
  dateHeading: string,
  harvested: LogRow[],
  header: string = TABLE_HEADER,
): string {
  let working = content;
  let lines = working.split("\n");
  let range = sectionRange(lines, dateHeading);
  if (!range) {
    const tail = working.endsWith("\n") ? "" : "\n";
    working = working + `${tail}\n${dateHeading}\n`;
    lines = working.split("\n");
    range = sectionRange(lines, dateHeading);
  }
  if (!range) return working;

  const existing = parseRowsInSection(working, dateHeading);
  const kept = existing.filter((r) => r.src !== SRC_DAILY);
  const merged = sortRows([...kept, ...harvested]);
  const tableLines = [header, TABLE_SEP, ...merged.map(renderRow)];

  let first = -1;
  let last = -1;
  for (let i = range.headingIdx + 1; i < range.end; i++) {
    if (lines[i].trim().startsWith("|")) {
      if (first === -1) first = i;
      last = i;
    }
  }
  if (first === -1) lines.splice(range.headingIdx + 1, 0, "", ...tableLines);
  else lines.splice(first, last - first + 1, ...tableLines);

  let out = lines.join("\n");
  out = upsertDayTotal(out, dateHeading, formatHuman(dayTotalMs(out, dateHeading)));
  return out;
}

/** Экранируем содержимое ячейки, чтобы `|` и переносы не ломали таблицу. */
export function cell(s: string): string {
  return (s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

/**
 * Вставляет строку `row` в таблицу под заголовком `dateHeading`.
 * - заголовка нет → добавляем секцию с шапкой таблицы в конец файла;
 * - заголовок есть, таблицы под ним нет → добавляем шапку + строку;
 * - таблица есть → дозаписываем строку в её конец.
 */
export function insertRow(
  content: string,
  dateHeading: string,
  row: string,
  header: string = TABLE_HEADER,
): string {
  const lines = content.split("\n");
  const headingIdx = lines.findIndex((l) => l.trim() === dateHeading);

  if (headingIdx === -1) {
    const tail = content.endsWith("\n") ? "" : "\n";
    return (
      content +
      `${tail}\n${dateHeading}\n\n${header}\n${TABLE_SEP}\n${row}\n`
    );
  }

  // Конец секции — следующий заголовок «## » или конец файла.
  let sectionEnd = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      sectionEnd = i;
      break;
    }
  }

  // Последняя строка таблицы внутри секции.
  let lastTableIdx = -1;
  for (let i = headingIdx + 1; i < sectionEnd; i++) {
    if (lines[i].trim().startsWith("|")) lastTableIdx = i;
  }

  if (lastTableIdx === -1) {
    lines.splice(headingIdx + 1, 0, "", header, TABLE_SEP, row);
  } else {
    lines.splice(lastTableIdx + 1, 0, row);
  }
  return lines.join("\n");
}
