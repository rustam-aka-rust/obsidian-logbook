import {
  App,
  ItemView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  WorkspaceLeaf,
  moment,
  normalizePath,
} from "obsidian";
import {
  LogRow,
  SRC_TIMER,
  TABLE_SEP,
  cell,
  dayTotalMs,
  ensureCssClass,
  formatDuration,
  formatHuman,
  insertRow,
  makeTableHeader,
  parseDailyMarkers,
  parseRowsInSection,
  syncDayFromDaily,
  upsertDayTotal,
} from "./logbook-core";
import { COLUMNS, Lang, Strings, getStrings, resolveLang } from "./i18n";

const VIEW_TYPE = "logbook-panel";

// ---------------------------------------------------------------------------
// Settings & state
// ---------------------------------------------------------------------------

interface ActiveSession {
  startISO: string;
  activity: string;
  category: string;
}

interface LogbookSettings {
  folder: string;
  fileNameFormat: string;
  timeFormat: string;
  knownCategories: string[];
  activeSession: ActiveSession | null;
  activityWords: number;
  language: string; // "auto" | "en" | "ru"
}

const DEFAULT_SETTINGS: LogbookSettings = {
  folder: "TimeLog",
  fileNameFormat: "YYYY-MM",
  timeFormat: "HH:mm",
  knownCategories: [],
  activeSession: null,
  activityWords: 7,
  language: "auto",
};

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default class LogbookPlugin extends Plugin {
  settings: LogbookSettings;
  t: Strings;
  lang: Lang;
  tableHeader: string;
  private statusBarEl: HTMLElement;

  async onload() {
    await this.loadSettings();
    this.applyLocale();

    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass("logbook-status");
    this.statusBarEl.onClickEvent(() => this.toggle());

    this.addRibbonIcon("clock", this.t.ribbonToggle, () => this.toggle());
    this.addRibbonIcon("timer", this.t.ribbonPanel, () => this.activateView());

    this.registerView(VIEW_TYPE, (leaf) => new LogbookView(leaf, this));

    this.addCommand({
      id: "open-panel",
      name: this.t.cmdOpenPanel,
      callback: () => this.activateView(),
    });
    this.addCommand({
      id: "start",
      name: this.t.cmdStart,
      callback: () => this.promptStart(),
    });
    this.addCommand({
      id: "stop",
      name: this.t.cmdStop,
      callback: () => this.stopTimer(),
    });
    this.addCommand({
      id: "cancel",
      name: this.t.cmdCancel,
      callback: () => this.cancelTimer(),
    });
    this.addCommand({
      id: "harvest-daily",
      name: this.t.cmdHarvest,
      callback: () => this.harvestActiveDaily(),
    });

    this.addSettingTab(new LogbookSettingTab(this.app, this));

    // Возобновляем running clock после перезапуска Obsidian + тик статусбара/панели.
    this.refreshStatusBar();
    this.registerInterval(
      window.setInterval(() => {
        this.refreshStatusBar();
        this.tickViews();
      }, 1000),
    );

    // Обновлять панель, когда меняется файл в папке TimeLog (ручная правка и т.п.).
    this.registerEvent(
      this.app.vault.on("modify", (f) => {
        if (this.app.workspace.getLeavesOfType(VIEW_TYPE).length === 0) return;
        const folder = normalizePath(this.settings.folder);
        if (f instanceof TFile && f.path.startsWith(folder)) this.refreshViews();
      }),
    );
  }

  /** Пересчитывает язык, строки и шапку таблицы из настроек. */
  applyLocale() {
    this.lang = resolveLang(this.settings.language);
    this.t = getStrings(this.lang);
    this.tableHeader = makeTableHeader(COLUMNS[this.lang]);
  }

  // --- Панель в сайдбаре ---------------------------------------------------

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof LogbookView) void leaf.view.render();
    }
  }

  private tickViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof LogbookView) leaf.view.tick();
    }
  }

  /** Данные за сегодня для панели: суммарное время и строки. */
  async getTodayData(): Promise<{ totalMs: number; rows: LogRow[] }> {
    const date = moment();
    const folder = normalizePath(this.settings.folder);
    const fileName = date.format(this.settings.fileNameFormat) + ".md";
    const filePath = normalizePath(folder ? `${folder}/${fileName}` : fileName);
    const f = this.app.vault.getAbstractFileByPath(filePath);
    if (!(f instanceof TFile)) return { totalMs: 0, rows: [] };
    const content = await this.app.vault.read(f);
    const heading = `## ${date.format("YYYY-MM-DD")}`;
    return {
      totalMs: dayTotalMs(content, heading),
      rows: parseRowsInSection(content, heading),
    };
  }

  /** Старт сессии из панели/кода (валидирует «Занятие»). */
  async startActivity(activity: string, category: string) {
    if (this.settings.activeSession) {
      new Notice(this.t.alreadyRunning);
      return;
    }
    const a = activity.trim();
    if (!a) {
      new Notice(this.t.activityRequired);
      return;
    }
    this.settings.activeSession = {
      startISO: moment().toISOString(),
      activity: a,
      category: (category || "").trim(),
    };
    await this.saveSettings();
    this.refreshStatusBar();
    this.refreshViews();
    new Notice(this.t.started(a));
  }

  private toggle() {
    if (this.settings.activeSession) this.stopTimer();
    else this.promptStart();
  }

  // --- Старт ---------------------------------------------------------------

  promptStart() {
    if (this.settings.activeSession) {
      new Notice(this.t.alreadyRunning);
      return;
    }
    new StartTimerModal(
      this.app,
      this.t,
      this.settings.knownCategories,
      (activity, category) => this.startActivity(activity, category),
    ).open();
  }

  // --- Стоп ----------------------------------------------------------------

  async stopTimer() {
    const session = this.settings.activeSession;
    if (!session) {
      new Notice(this.t.notRunning);
      return;
    }
    const start = moment(session.startISO);
    const end = moment();
    try {
      await this.writeEntry(session, start, end);
    } catch (e) {
      console.error("Logbook: write error", e);
      new Notice(this.t.writeFail);
      return; // сессию не теряем — можно повторить «Стоп»
    }
    this.rememberCategory(session.category);
    new Notice(this.t.stopped(session.activity, formatHuman(end.diff(start))));
    this.settings.activeSession = null;
    await this.saveSettings();
    this.refreshStatusBar();
    this.refreshViews();
  }

  async cancelTimer() {
    if (!this.settings.activeSession) {
      new Notice(this.t.notRunning);
      return;
    }
    this.settings.activeSession = null;
    await this.saveSettings();
    this.refreshStatusBar();
    this.refreshViews();
    new Notice(this.t.canceled);
  }

  // --- Сбор из дейлика -----------------------------------------------------

  async harvestActiveDaily() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice(this.t.openDaily);
      return;
    }
    const date = moment(file.basename, "YYYY-MM-DD", true);
    if (!date.isValid()) {
      new Notice(this.t.notDaily);
      return;
    }

    const content = await this.app.vault.read(file);
    const harvested = parseDailyMarkers(content, this.settings.activityWords);
    if (harvested.length === 0) {
      new Notice(this.t.noMarkers);
      return;
    }

    const folder = normalizePath(this.settings.folder);
    await this.ensureFolder(folder);
    const monthLabel = date.format(this.settings.fileNameFormat);
    const fileName = monthLabel + ".md";
    const filePath = normalizePath(folder ? `${folder}/${fileName}` : fileName);
    const dateHeading = `## ${date.format("YYYY-MM-DD")}`;

    const apply = (data: string): string =>
      ensureCssClass(
        syncDayFromDaily(data, dateHeading, harvested, this.tableHeader),
      );

    try {
      const existing = this.app.vault.getAbstractFileByPath(filePath);
      if (existing instanceof TFile) {
        await this.app.vault.process(existing, apply);
      } else {
        await this.app.vault.create(filePath, apply(`# TimeLog ${monthLabel}\n`));
      }
    } catch (e) {
      console.error("Logbook: harvest error", e);
      new Notice(this.t.harvestFail);
      return;
    }

    this.refreshViews();
    new Notice(this.t.harvested(harvested.length, date.format("YYYY-MM-DD")));
  }

  // --- Запись в файл -------------------------------------------------------

  async writeEntry(
    session: ActiveSession,
    start: moment.Moment,
    end: moment.Moment,
  ) {
    const folder = normalizePath(this.settings.folder);
    await this.ensureFolder(folder);

    const fileName = start.format(this.settings.fileNameFormat) + ".md";
    const filePath = normalizePath(
      folder ? `${folder}/${fileName}` : fileName,
    );
    const dateHeading = `## ${start.format("YYYY-MM-DD")}`;
    const row =
      `| ${start.format(this.settings.timeFormat)} ` +
      `| ${end.format(this.settings.timeFormat)} ` +
      `| ${formatHuman(end.diff(start))} ` +
      `| ${cell(session.category)} ` +
      `| ${cell(session.activity)} ` +
      `| ${SRC_TIMER} |`;

    const withTotal = (data: string): string => {
      let next = ensureCssClass(
        insertRow(data, dateHeading, row, this.tableHeader),
      );
      next = upsertDayTotal(
        next,
        dateHeading,
        formatHuman(dayTotalMs(next, dateHeading)),
      );
      return next;
    };

    const existing = this.app.vault.getAbstractFileByPath(filePath);
    if (existing instanceof TFile) {
      await this.app.vault.process(existing, withTotal);
    } else {
      const monthLabel = start.format(this.settings.fileNameFormat);
      const base =
        `# TimeLog ${monthLabel}\n\n${dateHeading}\n\n` +
        `${this.tableHeader}\n${TABLE_SEP}\n`;
      // insertRow дозапишет строку под уже существующий заголовок дня.
      await this.app.vault.create(filePath, withTotal(base));
    }
  }

  private async ensureFolder(folder: string) {
    if (!folder) return;
    const existing = this.app.vault.getAbstractFileByPath(folder);
    if (existing instanceof TFolder) return;
    try {
      await this.app.vault.createFolder(folder);
    } catch (_e) {
      // папка могла появиться между проверкой и созданием — игнорируем
    }
  }

  private rememberCategory(category: string) {
    const c = category.trim();
    if (!c || this.settings.knownCategories.includes(c)) return;
    this.settings.knownCategories.push(c);
    this.settings.knownCategories.sort((a, b) => a.localeCompare(b));
  }

  // --- Статусбар -----------------------------------------------------------

  private refreshStatusBar() {
    const s = this.settings.activeSession;
    if (!s) {
      this.statusBarEl.setText(this.t.statusIdle);
      this.statusBarEl.removeClass("is-running");
      this.statusBarEl.setAttribute("aria-label", this.t.ariaStart);
      return;
    }
    const dur = formatDuration(moment().diff(moment(s.startISO)));
    this.statusBarEl.setText(`● ${dur} · ${s.activity}`);
    this.statusBarEl.addClass("is-running");
    this.statusBarEl.setAttribute("aria-label", this.t.ariaStop);
  }

  // --- Настройки -----------------------------------------------------------

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

// ---------------------------------------------------------------------------
// Панель в сайдбаре
// ---------------------------------------------------------------------------

class LogbookView extends ItemView {
  private plugin: LogbookPlugin;
  private elapsedEl: HTMLElement | null = null;
  // Защита от гонки: refreshViews() может прилететь дважды на одно действие
  // (явный вызов + событие vault "modify"). Сериализуем рендер и схлопываем
  // лишние вызовы, иначе два await-рендера дают дубль панели.
  private rendering = false;
  private renderQueued = false;

  constructor(leaf: WorkspaceLeaf, plugin: LogbookPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return "Logbook";
  }

  getIcon() {
    return "clock";
  }

  async onOpen() {
    await this.render();
  }

  /** Лёгкое обновление раз в секунду — только цифра живого таймера. */
  tick() {
    const s = this.plugin.settings.activeSession;
    if (s && this.elapsedEl) {
      this.elapsedEl.setText(
        "● " + formatDuration(moment().diff(moment(s.startISO))),
      );
    }
  }

  async render() {
    // Уже идёт рендер — отметим, что нужен ещё один, и выйдем.
    if (this.rendering) {
      this.renderQueued = true;
      return;
    }
    this.rendering = true;
    try {
      await this.doRender();
    } finally {
      this.rendering = false;
      if (this.renderQueued) {
        this.renderQueued = false;
        void this.render();
      }
    }
  }

  private async doRender() {
    const t = this.plugin.t;
    const root = this.contentEl;

    // Данные тянем ДО очистки: empty() + построение делаем одним куском
    // после await — атомарная замена, без мигания и без двойного DOM.
    const { totalMs, rows } = await this.plugin.getTodayData();
    const session = this.plugin.settings.activeSession;

    root.empty();
    root.addClass("logbook-panel");

    // Total за сегодня
    const total = root.createDiv({ cls: "lp-total" });
    total.createDiv({ cls: "lp-total-num", text: formatHuman(totalMs) });
    total.createDiv({ cls: "lp-total-cap", text: t.panelToday });

    root.createEl("hr");

    // Управление
    const ctrl = root.createDiv({ cls: "lp-control" });
    if (session) {
      this.elapsedEl = ctrl.createDiv({
        cls: "lp-elapsed",
        text: "● " + formatDuration(moment().diff(moment(session.startISO))),
      });
      ctrl.createDiv({ cls: "lp-activity", text: session.activity });
      const btns = ctrl.createDiv({ cls: "lp-btns" });
      btns
        .createEl("button", { cls: "mod-cta", text: t.panelStop })
        .addEventListener("click", () => void this.plugin.stopTimer());
      btns
        .createEl("button", { text: t.panelCancel })
        .addEventListener("click", () => void this.plugin.cancelTimer());
    } else {
      this.elapsedEl = null;
      const actField = ctrl.createDiv({ cls: "lp-field" });
      actField.createEl("label", { text: t.fieldActivity });
      const actInput = actField.createEl("input");
      actInput.type = "text";
      actInput.placeholder = t.phActivity;

      const catField = ctrl.createDiv({ cls: "lp-field" });
      catField.createEl("label", { text: t.fieldCategory });
      const catInput = catField.createEl("input");
      catInput.type = "text";
      catInput.placeholder = t.phOptional;
      const listId = "logbook-panel-cats";
      const datalist = catField.createEl("datalist");
      datalist.id = listId;
      for (const c of this.plugin.settings.knownCategories) {
        datalist.createEl("option").value = c;
      }
      catInput.setAttribute("list", listId);

      const start = ctrl.createEl("button", {
        cls: "mod-cta lp-start",
        text: t.panelStart,
      });
      const go = () =>
        void this.plugin.startActivity(actInput.value, catInput.value);
      start.addEventListener("click", go);
      for (const el of [actInput, catInput]) {
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter") go();
        });
      }
      window.setTimeout(() => actInput.focus(), 0);
    }

    root.createEl("hr");

    // Список за сегодня
    const today = root.createDiv({ cls: "lp-today" });
    today.createDiv({ cls: "lp-today-h", text: t.panelTodayH });
    if (rows.length === 0) {
      today.createDiv({ cls: "lp-empty", text: t.panelEmpty });
    } else {
      for (const r of rows) {
        const item = today.createDiv({ cls: "lp-row" });
        item.createSpan({ cls: "lp-dur", text: r.dur });
        item.createSpan({ cls: "lp-act", text: r.activity });
        item.createSpan({ cls: "lp-src", text: r.src });
      }
    }

    root.createEl("hr");

    root
      .createEl("button", { cls: "lp-harvest", text: t.panelHarvest })
      .addEventListener("click", () => void this.plugin.harvestActiveDaily());
  }
}

// ---------------------------------------------------------------------------
// Start modal
// ---------------------------------------------------------------------------

class StartTimerModal extends Modal {
  private t: Strings;
  private categories: string[];
  private onSubmit: (activity: string, category: string) => void;
  private activity = "";
  private category = "";

  constructor(
    app: App,
    t: Strings,
    categories: string[],
    onSubmit: (activity: string, category: string) => void,
  ) {
    super(app);
    this.t = t;
    this.categories = categories;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.t.modalTitle });

    new Setting(contentEl).setName(this.t.fieldActivity).addText((t) => {
      t.setPlaceholder(this.t.phActivity);
      t.onChange((v) => (this.activity = v));
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") this.submit();
      });
      window.setTimeout(() => t.inputEl.focus(), 0);
    });

    new Setting(contentEl).setName(this.t.fieldCategory).addText((t) => {
      t.setPlaceholder(this.t.phOptional);
      t.onChange((v) => (this.category = v));

      // datalist — автоподстановка прежних значений
      const listId = "logbook-categories";
      const datalist = contentEl.createEl("datalist");
      datalist.id = listId;
      for (const c of this.categories) datalist.createEl("option", { value: c });
      t.inputEl.setAttribute("list", listId);

      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") this.submit();
      });
    });

    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText(this.t.btnStart)
        .setCta()
        .onClick(() => this.submit()),
    );
  }

  private submit() {
    const activity = this.activity.trim();
    if (!activity) {
      new Notice(this.t.activityRequired);
      return;
    }
    this.close();
    this.onSubmit(activity, this.category.trim());
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

class LogbookSettingTab extends PluginSettingTab {
  plugin: LogbookPlugin;

  constructor(app: App, plugin: LogbookPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const t = this.plugin.t;
    containerEl.empty();

    new Setting(containerEl)
      .setName(t.setFolderName)
      .setDesc(t.setFolderDesc)
      .addText((c) =>
        c.setValue(this.plugin.settings.folder).onChange(async (v) => {
          this.plugin.settings.folder = v.trim() || "TimeLog";
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t.setFileFmtName)
      .setDesc(t.setFileFmtDesc)
      .addText((c) =>
        c.setValue(this.plugin.settings.fileNameFormat).onChange(async (v) => {
          this.plugin.settings.fileNameFormat = v.trim() || "YYYY-MM";
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t.setTimeFmtName)
      .setDesc(t.setTimeFmtDesc)
      .addText((c) =>
        c.setValue(this.plugin.settings.timeFormat).onChange(async (v) => {
          this.plugin.settings.timeFormat = v.trim() || "HH:mm";
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t.setWordsName)
      .setDesc(t.setWordsDesc)
      .addText((c) =>
        c
          .setValue(String(this.plugin.settings.activityWords))
          .onChange(async (v) => {
            const n = parseInt(v.trim(), 10);
            this.plugin.settings.activityWords =
              Number.isFinite(n) && n > 0 ? n : 7;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t.setLangName)
      .setDesc(t.setLangDesc)
      .addDropdown((d) =>
        d
          .addOption("auto", t.langAuto)
          .addOption("en", "English")
          .addOption("ru", "Русский")
          .setValue(this.plugin.settings.language)
          .onChange(async (v) => {
            this.plugin.settings.language = v;
            await this.plugin.saveSettings();
            this.plugin.applyLocale();
            this.plugin.refreshViews();
            this.display();
          }),
      );
  }
}
