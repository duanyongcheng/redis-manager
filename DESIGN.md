# Design system

<!-- impeccable:design-schema 1 -->

Redis Manager's interface is a **protocol analyser**. The reader is inspecting live data from one
or more Redis instances, so the screen is organised the way an analyser is: a list on top, the
selected item expanded as a field tree, its history underneath, and a side panel of findings.
Data is monospace and sits in fixed columns. Surfaces are flat and separated by 1px rules — nothing
floats, so the eye never has to re-find an edge when values change.

Tokens live in `src/styles/tokens.css`; components in `src/styles/components.css` read only those
tokens. There is one visual language and two colour schemes (`data-scheme="light" | "dark"`);
**light is the default**, chosen by the owner — dark is a first-class alternative, not a fallback.

## Product at a glance

```
实例栏         实例标题栏               视图
grouped        name · address · engine  ├ 总览   读数 → 指标流 / 详情 / 历史 + 告警
connections    · mode · database · live ├ 键     扫描与筛选 → 键列表 / 值
               ─────────────────────    ├ 命令行 多会话 · 只读
               视图标签                  └ 监控   趋势 · 复制 · INFO · 慢查询 · 客户端
```

The sidebar is the only navigation axis. Views (总览 / 键 / 命令行 / 监控) are inside the
selected instance; 连接管理 and 设置 are global and sit in the sidebar footer.

## Colour

| Token | Dark | Light | Job |
|---|---|---|---|
| `--bg` | `#101417` | `#fbfbfc` | chrome: top bar, sidebar, status bar, pane headers |
| `--bg-panel` | `#14191d` | `#ffffff` | the surface data is read on |
| `--bg-sunken` | `#0c1013` | `#f4f6f7` | inset tracks, list headers |
| `--line` | `#262e34` | `#e3e6ea` | every separator |
| `--line-soft` | `#1d2429` | `#eef0f2` | row rules inside a pane |
| `--fg` | `#e4e8eb` | `#16191c` | primary data |
| `--fg-2` | `#9aa6ae` | `#5f6b76` | labels, secondary data |
| `--fg-3` | `#7f8b94` | `#667079` | meta, units, placeholders — 5.08 / 5.05:1 on the panel |
| `--accent` | `#35b8c6` | `#0f8f9e` | **only** the current thing: selection, active tab, primary action, live dot, focus |
| `--ok` | `#4cae7d` | `#2f7a55` | connected, healthy |
| `--warn` | `#d99a32` | `#a8660a` | advisories, failing conditions |
| `--err` | `#e06a5c` | `#b23c31` | critical, destructive |

Rules:
- The accent has exactly three jobs: **current state** (selected row, active tab, focus, live dot), **the primary action**, and **the measured line** in a chart. It never decorates: anything accent-coloured that is not one of those three is wrong.
- The semantic colours carry state; they never fill a whole surface, only text, a rule, a 1px border, or a tinted row.
- Status is never colour alone: a dot always sits beside a word (`已连接` / `未连接`) or a labelled finding.

Redis data types keep a quiet palette so a key list can be scanned: `--type-string` (accent),
`--type-hash`, `--type-list` (ok), `--type-set` (warn), `--type-zset`, `--type-stream`.

## Type

| Role | Face | Size | Notes |
|---|---|---|---|
| UI labels, headings | `--font-ui` (system / PingFang SC) | 11.5–15px | weights 400/500/600 only |
| Data, identifiers, units, meta | `--font-mono` (SF Mono…) | 10–13px | always `tabular-nums` |
| Readout figure | mono | 19px / 500 | `letter-spacing: -.02em` |
| Column and field labels | mono | 10px | `letter-spacing: .06em`, paired with an English key (`ops/s`, `latency`) |

Counts are rendered with `count()` (whole numbers); rates and timings keep their decimals.
Numbers never change width between paints: tabular figures everywhere.

## Geometry

| Token | Value | Use |
|---|---|---|
| `--radius` | 4px (`--radius-sm` 3, `--radius-xs` 2) | controls, chips, dialogs |
| `--space-1…6` | 4 / 8 / 12 / 16 / 24 / 32 | the only spacing values used |
| `--pad-x` | 24px | horizontal padding of every pane |
| `--row-h` | 26px | analysis rows (stream, keys) |
| `--control-h` | 28px | buttons, inputs, selects |
| `--topbar-h` / `--sidebar-w` / `--statusbar-h` | 48 / 232 / 26px | shell |

No shadow on any in-page surface. `--shadow-pop` is reserved for true overlays (dialogs, palette, toasts).

## Components

- **Readout strip** (`.reads` / `.read`) — four metrics in a row of ruled cells: mono label + English
  key, figure, unit, delta, one detail line. Replaces KPI cards.
- **Analyser** (`.analyser`) — the signature. Left: `.stream` (a 26px-row sample list with a
  selection bar, event flags, arrow-key roving and dimmed `推算` rows), `.detail` (three columns of
  field trees: the sample, its delta, the server), `.hist` (a trend chart marking the earliest
  timestamped finding in its tone, or the inspected sample in accent). Right: `.findings` (advisory
  list with jump links).
- **Pane** (`.pane`) — a ruled header plus body. The only container for grouped content.
- **Key list** (`.key-row`) — name in mono, TTL right-aligned, type as a colour-coded 9.5px mono
  word. Selection is an accent left rule + tinted row; ↑/↓ roves the selection.
- **Connection table** (`.conn-row`) — one ruled row per instance with the same columns as the key
  list (state · name · address · group · version · latency · mode · badges · actions); actions
  appear on hover, focus or selection.
- **Colour picker** (`.color-swatch`) — the connection's identity colour, chosen from seven fixed
  swatches (default + six muted hues). It paints a 7px mark beside the instance name and never the
  status dot, so identity can never be mistaken for state; a red or amber status always outranks it.
- **Detail tree** (`.kv-row`) — field name left (with a 4px dot marker), value right in mono. Used for
  value metadata, INFO, and the sample inspector.
- **Filter bar** (`.filterbar`), **chips** (`.chip`), **segmented** (`.segmented`, underline or boxed),
  **switch**, **notice**, **dialog**, **palette**, **toast**: standard shapes a web user already knows.

## States

- **Loading** — `.skeleton` blocks in the shape of the content; a spinner only inside a control.
- **Empty** — `.empty-state`: one sentence about what will appear, plus the action that creates it.
- **Error** — `.notice.err` with the server's own message inside the pane it failed in; never a modal.
- **Offline** — the instance header turns its live dot off and says 未连接; the status bar repeats it.
  Data already fetched stays visible and is labelled as the last sample.
- **Extrapolated rows** — when a session is younger than the window the stream claims, the list is
  extended backwards with rows that carry a timestamp and no values (`推算`), so the time scale stays
  continuous without inventing measurements. Charts plot measured samples only and say
  `N 个实测样本`.

## Motion

One authored moment: the main column rises 4px and fades in on first paint (`.app.entering`),
removed after it plays so constant re-renders never re-trigger it. Everything else is a 140ms
`--ease` transition on colour, border and background. `prefers-reduced-motion` disables both.

## Layout rules

- The shell is a three-row grid (top bar / workspace / status bar) with definite track sizes; the
  workspace is the sidebar plus the main column; the main column is header → tabs → content, and
  the content area is the only thing that scrolls, except in views that manage their own panes.
- Breakpoints: below 1240px the analyser's side panel narrows to 280px and the detail drops to two
  columns; below 1180px the analyser stacks (stream → detail → history → findings) and the page
  scrolls, the sidebar narrows to 196px, and pane headings drop their English keys; below 1100px the
  key list takes 42% of the browser width; below 900px the key browser stacks.
- At 1280px (the stated window floor) and at 1024px every view keeps its full structure; nothing is
  clipped or overlapped. The CLI panel is a desktop surface and is not designed for phone widths.

## Copy

Chinese UI, English keys on **column headers and field-tree rows** where they disambiguate
(`时间 time`, `操作数 ops`, `Δ 对比 delta`) — never as a kicker above a pane heading. Status is a
word next to its dot (`已连接` / `未连接`). Controls name their action
(`写入字段`, `继续 SCAN`, `重新读取`). Errors name the problem and the recovery, in the server's words.
