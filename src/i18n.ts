// ---------------------------------------------------------------------------
// Локализация интерфейса (en/ru). Формат файла парсится по структуре, не по
// языку, поэтому смена языка/старые файлы ничего не ломают.
// ---------------------------------------------------------------------------

export type Lang = "en" | "ru";

/** Колонки таблицы по языку (порядок фиксирован). */
export const COLUMNS: Record<Lang, string[]> = {
  en: ["Start", "Stop", "Dur", "Category", "Activity", "Src"],
  ru: ["Старт", "Стоп", "Длит", "Категория", "Занятие", "Ист."],
};

export interface Strings {
  ribbonToggle: string;
  ribbonPanel: string;
  cmdOpenPanel: string;
  cmdStart: string;
  cmdStop: string;
  cmdCancel: string;
  cmdHarvest: string;
  alreadyRunning: string;
  activityRequired: string;
  notRunning: string;
  canceled: string;
  writeFail: string;
  openDaily: string;
  notDaily: string;
  noMarkers: string;
  harvestFail: string;
  started: (activity: string) => string;
  stopped: (activity: string, dur: string) => string;
  harvested: (n: number, date: string) => string;
  modalTitle: string;
  fieldActivity: string;
  phActivity: string;
  fieldCategory: string;
  phOptional: string;
  btnStart: string;
  statusIdle: string;
  ariaStart: string;
  ariaStop: string;
  setFolderName: string;
  setFolderDesc: string;
  setFileFmtName: string;
  setFileFmtDesc: string;
  setTimeFmtName: string;
  setTimeFmtDesc: string;
  setWordsName: string;
  setWordsDesc: string;
  setLangName: string;
  setLangDesc: string;
  langAuto: string;
  panelToday: string;
  panelTodayH: string;
  panelEmpty: string;
  panelStop: string;
  panelCancel: string;
  panelStart: string;
  panelHarvest: string;
}

const EN: Strings = {
  ribbonToggle: "Logbook: start / stop",
  ribbonPanel: "Logbook: panel",
  cmdOpenPanel: "Open panel",
  cmdStart: "Start timer",
  cmdStop: "Stop timer",
  cmdCancel: "Cancel timer (no entry)",
  cmdHarvest: "Harvest time from the open daily note",
  alreadyRunning: "Timer is already running. Stop it first.",
  activityRequired: "Activity is required.",
  notRunning: "Timer is not running.",
  canceled: "Timer canceled, nothing recorded.",
  writeFail: "Logbook: failed to write the interval (see console).",
  openDaily: "Open a daily note and try again.",
  notDaily: "The active file doesn't look like a daily note (expected YYYY-MM-DD).",
  noMarkers: "No time markers like [..] found in the daily note.",
  harvestFail: "Logbook: failed to harvest from the daily note (see console).",
  started: (a) => `▶ ${a}`,
  stopped: (a, d) => `⏹ ${a} · ${d}`,
  harvested: (n, date) => `📓 Harvested from daily: ${n} for ${date}.`,
  modalTitle: "Start timer",
  fieldActivity: "Activity",
  phActivity: "What am I doing…",
  fieldCategory: "Category",
  phOptional: "optional",
  btnStart: "Start",
  statusIdle: "○ Logbook",
  ariaStart: "Logbook: start timer",
  ariaStop: "Logbook: stop timer",
  setFolderName: "Logbook folder",
  setFolderDesc: "Where to put monthly files.",
  setFileFmtName: "File name format",
  setFileFmtDesc: "moment.js format. Default YYYY-MM → one file per month.",
  setTimeFmtName: "Time format",
  setTimeFmtDesc: "moment.js format for the Start/Stop columns.",
  setWordsName: "Words in “Activity” when harvesting",
  setWordsDesc: "How many first words from the daily marker go into the Activity column (then “…”).",
  setLangName: "Language",
  setLangDesc: "Interface and logbook column language. Reload to apply fully.",
  langAuto: "Auto (Obsidian)",
  panelToday: "today",
  panelTodayH: "Today",
  panelEmpty: "empty for now",
  panelStop: "Stop",
  panelCancel: "Cancel",
  panelStart: "▶ Start",
  panelHarvest: "📓 Harvest daily",
};

const RU: Strings = {
  ribbonToggle: "Logbook: старт / стоп",
  ribbonPanel: "Logbook: панель",
  cmdOpenPanel: "Открыть панель",
  cmdStart: "Старт таймера",
  cmdStop: "Стоп таймера",
  cmdCancel: "Отменить таймер (без записи)",
  cmdHarvest: "Собрать время из открытого дейлика",
  alreadyRunning: "Таймер уже идёт. Сначала «Стоп».",
  activityRequired: "Поле «Занятие» обязательно.",
  notRunning: "Таймер не запущен.",
  canceled: "Таймер отменён, ничего не записано.",
  writeFail: "Logbook: не удалось записать интервал (см. консоль).",
  openDaily: "Открой дейлик и повтори.",
  notDaily: "Активный файл не похож на дейлик (ожидаю имя YYYY-MM-DD).",
  noMarkers: "В дейлике не нашёл маркеров времени вида [..].",
  harvestFail: "Logbook: не удалось собрать из дейлика (см. консоль).",
  started: (a) => `▶ ${a}`,
  stopped: (a, d) => `⏹ ${a} · ${d}`,
  harvested: (n, date) => `📓 Собрано из дейлика: ${n} зап. за ${date}.`,
  modalTitle: "Старт таймера",
  fieldActivity: "Занятие",
  phActivity: "Что делаю…",
  fieldCategory: "Категория",
  phOptional: "необязательно",
  btnStart: "Старт",
  statusIdle: "○ Logbook",
  ariaStart: "Logbook: старт таймера",
  ariaStop: "Logbook: стоп таймера",
  setFolderName: "Папка logbook",
  setFolderDesc: "Куда складывать месячные файлы.",
  setFileFmtName: "Шаблон имени файла",
  setFileFmtDesc: "Формат moment.js. По умолчанию YYYY-MM → один файл на месяц.",
  setTimeFmtName: "Формат времени",
  setTimeFmtDesc: "Формат moment.js для колонок Старт/Стоп.",
  setWordsName: "Слов в «Занятии» при сборе",
  setWordsDesc: "Сколько первых слов из дейлика попадёт в колонку «Занятие» (дальше — «…»).",
  setLangName: "Язык",
  setLangDesc: "Язык интерфейса и колонок логбука. Перезагрузите для полного применения.",
  langAuto: "Авто (Obsidian)",
  panelToday: "сегодня",
  panelTodayH: "Сегодня",
  panelEmpty: "пока пусто",
  panelStop: "Стоп",
  panelCancel: "Отмена",
  panelStart: "▶ Старт",
  panelHarvest: "📓 Собрать дейлик",
};

/** Разрешает язык: явная настройка en/ru, иначе по языку Obsidian. */
export function resolveLang(setting: string): Lang {
  if (setting === "en" || setting === "ru") return setting;
  let sys = "en";
  try {
    sys = (window.localStorage.getItem("language") || "en").toLowerCase();
  } catch {
    // нет window (тесты) — остаёмся на en
  }
  return sys.startsWith("ru") ? "ru" : "en";
}

export function getStrings(lang: Lang): Strings {
  return lang === "ru" ? RU : EN;
}
