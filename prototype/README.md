# Redis Manager — UI 原型

纯静态的高保真原型（HTML + CSS + 原生 JS，零依赖、零构建），用来先定交互与视觉，再进入 Go / MyGo 实现。

## 从哪里开始

- **风格选择页**：[`styles/index.html`](styles/index.html) —— 四种风格一览，点击进入各自原型
- **主原型（第 1 版，深/浅色可切换）**：[`index.html`](index.html)
- 方案与实现建议：[`../docs/ui-prototype.md`](../docs/ui-prototype.md)
- 四套风格对比：[`../docs/styles.md`](../docs/styles.md)
- 设计稿截图：[`../docs/screenshots/`](../docs/screenshots)（各风格在 `screenshots/styles/`）

直接双击 HTML 即可，或起一个静态服务：

```bash
python3 -m http.server 8080
# http://localhost:8080/styles/index.html
```

## 四套风格

| 风格 | 入口 | 说明 |
|---|---|---|
| A · Terminal | `styles/terminal.html` | 等宽字体 + 琥珀荧光，ASCII 方框与进度条 |
| B · Craft | `styles/craft.html` | 暖纸色、衬线标题、三栏目录式布局（默认浅色） |
| C · Console | `styles/console.html` | 深色高密度仪表盘，⌘K 命令面板，锁屏页 |
| D · Airy | `styles/airy.html` | 悬浮大圆角窗口、紫粉渐变、玻璃质感 |

公共的 URL 参数：

| 参数 | 说明 | 示例 |
|---|---|---|
| `page` | `overview` \| `browser` \| `cli` \| `monitor` \| `connections` \| `settings` | `?page=browser` |
| `theme` | `dark` \| `light`（主原型与 A/B 支持） | `?theme=light` |
| `dialog` | `1` 打开新建连接对话框（主原型） | `?page=connections&dialog=1` |
| `palette` | `1` 打开 ⌘K 命令面板（C/D） | `?page=overview&palette=1` |
| `lock` | `1` 显示锁屏页（C） | `?page=overview&lock=1` |
| `scroll` | 内容区初始滚动位置 px（主原型） | `?page=monitor&scroll=900` |

## 目录

```
prototype/
├── index.html              主原型（第 1 版）
├── css/app.css
├── js/                     icons · data · charts · views · app
└── styles/
    ├── index.html          风格选择页
    ├── previews/           风格封面缩略图
    ├── common.js           四种风格共用的数据/图标/图表（data.js 也在这里用）
    ├── terminal.{html,css,js}
    ├── craft.{html,css,js}
    ├── console.{html,css,js}
    └── airy.{html,css,js}
```

设计 token 全部集中在各自 CSS 的 `:root` / `[data-theme]` 上，改一处全局生效；迁移到 MyGo 的 Vite 前端时可直接复用。
