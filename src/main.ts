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
  TABLE_HEADER,
  TABLE_SEP,
  cell,
  dayTotalMs,
  ensureCssClass,
  formatDuration,
  formatHuman,
  insertRow,
  parseDailyMarkers,
  parseRowsInSection,
  syncDayFromDaily,
  upsertDayTotal,
} from "./logbook-core";

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
}

const DEFAULT_SETTINGS: LogbookSettings = {
  folder: "TimeLog",
  fileNameFormat: "YYYY-MM",
  timeFormat: "HH:mm",
  knownCategories: [],
  activeSession: null,
  activityWords: 7,
};

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default class LogbookPlugin extends Plugin {
  settings: LogbookSettings;
  private statusBarEl: HTMLElement;

  async onload() {
    await this.loadSettings();

    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass("logbook-status");
    this.statusBarEl.onClickEvent(() => this.toggle());

    this.addRibbonIcon("clock", "Logbook: старт / стоп", () => this.toggle());
    this.addRibbonIcon("timer", "Logbook: панель", () => this.activateView());

    this.registerView(VIEW_TYPE, (leaf) => new LogbookView(leaf, this));

    this.addCommand({
      id: "open-panel",
      name: "Открыть панель",
      callback: () => this.activateView(),
    });
    this.addCommand({
      id: "start",
      name: "Старт таймера",
      callback: () => this.promptStart(),
    });
    this.addCommand({
      id: "stop",
      name: "Стоп таймера",
      callback: () => this.stopTimer(),
    });
    this.addCommand({
      id: "cancel",
      name: "Отменить таймер (без записи)",
      callback: () => this.cancelTimer(),
    });
    this.addCommand({
      id: "harvest-daily",
      name: "Собрать время из открытого дейлика",
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
      new Notice("Таймер уже идёт. Сначала «Стоп».");
      return;
    }
    const a = activity.trim();
    if (!a) {
      new Notice("Поле «Занятие» обязательно.");
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
    new Notice(`▶ ${a}`);
  }

  private toggle() {
    if (this.settings.activeSession) this.stopTimer();
    else this.promptStart();
  }

  // --- Старт ---------------------------------------------------------------

  promptStart() {
    if (this.settings.activeSession) {
      new Notice("Таймер уже идёт. Сначала «Стоп».");
      return;
    }
    new StartTimerModal(
      this.app,
      this.settings.knownCategories,
      (activity, category) => this.startActivity(activity, category),
    ).open();
  }

  // --- Стоп ----------------------------------------------------------------

  async stopTimer() {
    const session = this.settings.activeSession;
    if (!session) {
      new Notice("Таймер не запущен.");
      return;
    }
    const start = moment(session.startISO);
    const end = moment();
    try {
      await this.writeEntry(session, start, end);
    } catch (e) {
      console.error("Logbook: ошибка записи интервала", e);
      new Notice("Logbook: не удалось записать интервал (см. консоль).");
      return; // сессию не теряем — можно повторить «Стоп»
    }
    this.rememberCategory(session.category);
    new Notice(`⏹ ${session.activity} · ${formatHuman(end.diff(start))}`);
    this.settings.activeSession = null;
    await this.saveSettings();
    this.refreshStatusBar();
    this.refreshViews();
  }

  async cancelTimer() {
    if (!this.settings.activeSession) {
      new Notice("Таймер не запущен.");
      return;
    }
    this.settings.activeSession = null;
    await this.saveSettings();
    this.refreshStatusBar();
    this.refreshViews();
    new Notice("Таймер отменён, ничего не записано.");
  }

  // --- Сбор из дейлика -----------------------------------------------------

  async harvestActiveDaily() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("Открой дейлик и повтори.");
      return;
    }
    const date = moment(file.basename, "YYYY-MM-DD", true);
    if (!date.isValid()) {
      new Notice("Активный файл не похож на дейлик (ожидаю имя YYYY-MM-DD).");
      return;
    }

    const content = await this.app.vault.read(file);
    const harvested = parseDailyMarkers(content, this.settings.activityWords);
    if (harvested.length === 0) {
      new Notice("В дейлике не нашёл маркеров времени вида [..].");
      return;
    }

    const folder = normalizePath(this.settings.folder);
    await this.ensureFolder(folder);
    const monthLabel = date.format(this.settings.fileNameFormat);
    const fileName = monthLabel + ".md";
    const filePath = normalizePath(folder ? `${folder}/${fileName}` : fileName);
    const dateHeading = `## ${date.format("YYYY-MM-DD")}`;

    const apply = (data: string): string =>
      ensureCssClass(syncDayFromDaily(data, dateHeading, harvested));

    try {
      const existing = this.app.vault.getAbstractFileByPath(filePath);
      if (existing instanceof TFile) {
        await this.app.vault.process(existing, apply);
      } else {
        await this.app.vault.create(filePath, apply(`# TimeLog ${monthLabel}\n`));
      }
    } catch (e) {
      console.error("Logbook: ошибка сбора из дейлика", e);
      new Notice("Logbook: не удалось собрать из дейлика (см. консоль).");
      return;
    }

    this.refreshViews();
    new Notice(
      `📓 Собрано из дейлика: ${harvested.length} зап. за ${date.format("YYYY-MM-DD")}.`,
    );
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
      let next = ensureCssClass(insertRow(data, dateHeading, row));
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
        `${TABLE_HEADER}\n${TABLE_SEP}\n`;
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
      this.statusBarEl.setText("○ Logbook");
      this.statusBarEl.removeClass("is-running");
      this.statusBarEl.setAttribute("aria-label", "Logbook: старт таймера");
      return;
    }
    const dur = formatDuration(moment().diff(moment(s.startISO)));
    this.statusBarEl.setText(`● ${dur} · ${s.activity}`);
    this.statusBarEl.addClass("is-running");
    this.statusBarEl.setAttribute("aria-label", "Logbook: стоп таймера");
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
    const root = this.contentEl;
    root.empty();
    root.addClass("logbook-panel");

    const { totalMs, rows } = await this.plugin.getTodayData();
    const session = this.plugin.settings.activeSession;

    // Total за сегодня
    const total = root.createDiv({ cls: "lp-total" });
    total.createDiv({ cls: "lp-total-num", text: formatHuman(totalMs) });
    total.createDiv({ cls: "lp-total-cap", text: "сегодня" });

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
        .createEl("button", { cls: "mod-cta", text: "Стоп" })
        .addEventListener("click", () => void this.plugin.stopTimer());
      btns
        .createEl("button", { text: "Отмена" })
        .addEventListener("click", () => void this.plugin.cancelTimer());
    } else {
      this.elapsedEl = null;
      const actField = ctrl.createDiv({ cls: "lp-field" });
      actField.createEl("label", { text: "Занятие" });
      const actInput = actField.createEl("input");
      actInput.type = "text";
      actInput.placeholder = "Что делаю…";

      const catField = ctrl.createDiv({ cls: "lp-field" });
      catField.createEl("label", { text: "Категория" });
      const catInput = catField.createEl("input");
      catInput.type = "text";
      catInput.placeholder = "необязательно";
      const listId = "logbook-panel-cats";
      const datalist = catField.createEl("datalist");
      datalist.id = listId;
      for (const c of this.plugin.settings.knownCategories) {
        datalist.createEl("option").value = c;
      }
      catInput.setAttribute("list", listId);

      const start = ctrl.createEl("button", {
        cls: "mod-cta lp-start",
        text: "▶ Старт",
      });
      const go = () => void this.plugin.startActivity(actInput.value, catInput.value);
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
    today.createDiv({ cls: "lp-today-h", text: "Сегодня" });
    if (rows.length === 0) {
      today.createDiv({ cls: "lp-empty", text: "пока пусто" });
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
      .createEl("button", { cls: "lp-harvest", text: "📓 Собрать дейлик" })
      .addEventListener("click", () => void this.plugin.harvestActiveDaily());
  }
}

// ---------------------------------------------------------------------------
// Start modal
// ---------------------------------------------------------------------------

class StartTimerModal extends Modal {
  private categories: string[];
  private onSubmit: (activity: string, category: string) => void;
  private activity = "";
  private category = "";

  constructor(
    app: App,
    categories: string[],
    onSubmit: (activity: string, category: string) => void,
  ) {
    super(app);
    this.categories = categories;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Старт таймера" });

    new Setting(contentEl).setName("Занятие").addText((t) => {
      t.setPlaceholder("Что делаю…");
      t.onChange((v) => (this.activity = v));
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") this.submit();
      });
      window.setTimeout(() => t.inputEl.focus(), 0);
    });

    new Setting(contentEl).setName("Категория").addText((t) => {
      t.setPlaceholder("необязательно");
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
        .setButtonText("Старт")
        .setCta()
        .onClick(() => this.submit()),
    );
  }

  private submit() {
    const activity = this.activity.trim();
    if (!activity) {
      new Notice("Поле «Занятие» обязательно.");
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
    containerEl.empty();

    new Setting(containerEl)
      .setName("Папка logbook")
      .setDesc("Куда складывать месячные файлы.")
      .addText((t) =>
        t.setValue(this.plugin.settings.folder).onChange(async (v) => {
          this.plugin.settings.folder = v.trim() || "TimeLog";
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Шаблон имени файла")
      .setDesc("Формат moment.js. По умолчанию YYYY-MM → один файл на месяц.")
      .addText((t) =>
        t.setValue(this.plugin.settings.fileNameFormat).onChange(async (v) => {
          this.plugin.settings.fileNameFormat = v.trim() || "YYYY-MM";
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Формат времени")
      .setDesc("Формат moment.js для колонок Старт/Стоп.")
      .addText((t) =>
        t.setValue(this.plugin.settings.timeFormat).onChange(async (v) => {
          this.plugin.settings.timeFormat = v.trim() || "HH:mm";
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Слов в «Занятии» при сборе")
      .setDesc(
        "Сколько первых слов из дейлика попадёт в колонку «Занятие» (дальше — «…»).",
      )
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.activityWords))
          .onChange(async (v) => {
            const n = parseInt(v.trim(), 10);
            this.plugin.settings.activityWords =
              Number.isFinite(n) && n > 0 ? n : 7;
            await this.plugin.saveSettings();
          }),
      );
  }
}
