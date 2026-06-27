# Logbook

A fast, friction-free **org-clock style time tracker** for [Obsidian](https://obsidian.md).
Start → name the activity → a live timer ticks in the status bar → stop, and the
interval is appended to a monthly logbook file (`TimeLog/YYYY-MM.md`).

It also lets you **harvest time straight from your daily notes**: jot a marker like
`[14:01 - 15:06] worked on the essay` while journaling, and Logbook collects it into
the same monthly log.

> **Note:** the plugin's UI is currently in **Russian** (the author's language).
> Localization contributions are welcome — see [Contributing](#contributing).

## Features

- ⏱ **One-click stopwatch** — ribbon icon, command, or status-bar click. Live `H:MM:SS` timer.
- 📅 **Monthly logbook** — one file per month, grouped by day, Dataview-friendly markdown table.
- Σ **Per-day totals** — rendered as a big headline number right in the file.
- 🎨 **Styled in the file itself** — the table looks like a dashboard via CSS, no custom renderer.
- 📓 **Harvest from daily notes** — inline markers (`[14:01 - 15:06] …`, `[20m] …`) collected into the log.
- 🔀 **Mixed days** — stopwatch entries (`▶`) and harvested entries (`📓`) coexist, sorted by time.
- 🪟 **Sidebar panel** — today's total, start/stop, live timer, today's entries, and a harvest button.
- 💾 **Survives restarts** — a running session is restored when Obsidian reopens.

## Screenshots

<!-- TODO: add screenshots before publishing to the community catalog -->
<!-- ![Logbook file view](docs/file-view.png) -->
<!-- ![Sidebar panel](docs/panel.png) -->

Example of a generated `TimeLog/2026-06.md` day section:

```markdown
## 2026-06-25

> [!logbook-total] 8h 45m

| Старт | Стоп  | Длит   | Категория | Занятие                    | Ист. |
|-------|-------|--------|-----------|----------------------------|------|
| 06:30 | 07:10 | 40m    |           | morning routine…           | 📓   |
| 08:30 | 14:00 | 5h 30m |           | school day, taught two…    | 📓   |
| 20:00 | 21:30 | 1h 30m | Research  | worked on the plugin       | ▶    |
```

## Installation

### Via BRAT (recommended for now)

1. Install the **BRAT** community plugin.
2. BRAT → *Add Beta plugin* → paste this repository's URL.
3. Enable **Logbook** in *Settings → Community plugins*.

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [release](../../releases).
2. Copy them into `<your-vault>/.obsidian/plugins/logbook/`.
3. Reload Obsidian and enable **Logbook** in *Settings → Community plugins*.

## Usage

- **Start/stop:** click the ⏱ ribbon icon, the status-bar item, or run the *Logbook* commands.
- **Sidebar panel:** ribbon icon or the *Logbook: open panel* command — start/stop, today's total, today's entries.
- A new month automatically creates a new `TimeLog/YYYY-MM.md` file.

### Harvest from daily notes

Write inline markers anywhere in a daily note named `YYYY-MM-DD.md`:

- `[14:01 - 15:06] description` — an interval (start / stop / duration).
- `[20m] description` (`[1h30m]`, `[45s]`, `[1ч30м]`) — duration only.

Then run **Logbook: harvest from the open daily**. The plugin reads the markers
(it never writes to your daily) and merges them into the monthly log:

- harvested rows are tagged `📓`, stopwatch rows `▶`;
- re-running is idempotent — it replaces only the `📓` rows for that day, keeping `▶` rows;
- the day is sorted by start time and the total recomputed.

Detection only triggers when the brackets contain a time-shaped value, so
`[[wikilinks]]`, `[text](links)` and headings like `### 09:00 - 12:00` are ignored.

## Settings

- **Logbook folder** — where monthly files live (default `TimeLog`).
- **File name format** — moment.js format (default `YYYY-MM`).
- **Time format** — for the Start/Stop columns (default `HH:mm`).
- **Words in "activity" when harvesting** — how many words of the daily marker go into the table (default 7).

## Development

```bash
npm install
npm run dev    # watch build
npm run build  # typecheck + production build
```

To auto-copy build artifacts into a test vault during `dev`, set the target plugin
folder via the `OBSIDIAN_PLUGIN_DIR` environment variable or a local (git-ignored)
`.obsidian-plugin-dir` file containing the path.

## Contributing

Issues and PRs welcome — including UI localization (the strings currently live in `src/main.ts`).

## License

[MIT](LICENSE) © Rustam Agamaliev
