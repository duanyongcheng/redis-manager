# Redis Manager

基于 Go + MyGo 的 Redis 桌面管理器。Go 侧提供连接保存、连接测试、SCAN、类型化值读取、CLI 执行与指标采样；
前端是一套共享的页面与状态层，**四套界面主题**（Console / Terminal / Craft / Airy）只是不同的 token。

![Console](docs/screenshots/themes/console-dark-overview.png)

## 主题

| 主题 | 风格 | 配色 |
|---|---|---|
| Console | 深色高密度仪表盘、珊瑚点缀、⌘K 命令面板 | 深 / 浅 |
| Terminal | 等宽字体、琥珀荧光、`[ ]` 方框与 `█░` 进度条 | 深色 |
| Craft | 暖纸色、衬线标题、细线与大留白 | 浅 / 深 |
| Airy | 悬浮圆角窗口、毛玻璃、紫粉渐变 | 深 / 浅 |

顶栏的层叠图标或「设置 → 外观」可切换主题，深/浅色按主题能力切换，选择会被记住。
设计与实现说明见 [docs/themes.md](docs/themes.md)。

## 开发

环境要求：Go 1.27+、Bun。

```bash
bun install
bun run dev          # MyGo 窗口 + Go 绑定 + Vite 开发服务器
bun run dev:web      # 只启动浏览器预览（没有 Go 绑定，界面会提示服务不可用）
bun run typecheck    # tsc --noEmit
bun run build:web    # 构建前端到 dist/
```

浏览器里带 `?preview=1` 打开时会加载 `scripts/preview-mock.js` 的演示数据，用于截图与纯前端调试。

## macOS 打包

```bash
./scripts/build.sh mac                    # 本机架构 .app + .dmg
./scripts/build.sh mac --arch universal   # Intel + Apple 芯片通用包
./scripts/build.sh all                    # macOS + 浏览器版
./scripts/build.sh checks                 # 只做 tsc + go vet
```

脚本会依次执行：环境预检（go / bun / node / mygo CLI）→ 版本与 git revision 汇报 → 清理 `build/`、`dist/` →
`tsc --noEmit` + `go vet` → `mygo build`（内部先跑 `build:web` 再嵌入）→ 列出产物与体积。
`--skip-dmg` / `--skip-installer` / `--sign <identity>` / `--no-checks` / `--no-clean` 见 `./scripts/build.sh --help`。

产物位于 `build/darwin-arm64/`：

- `redis-manager.app`
- `redis-manager-0.1.0-arm64.dmg`

打包使用 MyGo 0.7.4，前端先由 Vite 构建并嵌入 Go 应用。版本号唯一来源是 `mygo.config.ts` 的 `version`。连接配置写入 `~/Library/Application Support/Redis Manager/connections.json`；
密码优先写入 MyGo 的系统凭据存储，不可用时才回退到该受限配置文件。

## 目录

| 路径 | 作用 |
|---|---|
| `main.go` | MyGo 窗口、Redis 服务与 typed bindings 来源 |
| `src/main.ts` | 前端入口（样式装配、绑定注入、按需加载预览数据） |
| `src/app.ts` | 渲染循环、事件委托、快捷键、连接编辑器 |
| `src/core/` | 状态 store、Go 绑定封装、格式化、图标、SVG 图表 |
| `src/ui/` | 壳层（顶栏/侧栏/页签/状态栏/命令面板）与小组件、告警推导 |
| `src/views/` | 总览 / 键浏览 / CLI / 监控 / 连接 / 设置 |
| `src/theme/` | 主题清单与设置存储 |
| `src/styles/` | token 契约与四套主题、基础样式、组件、页面布局 |
| `src/mygo.ts` | MyGo 自动生成的 TypeScript 客户端 |
| `scripts/` | 预览假数据、headless 截图脚本 |
| `docs/ui-prototype.md` | 信息架构、交互约定与 Go 接口建议 |
| `docs/themes.md` | 主题系统说明（token、结构轴、如何新增主题） |
| `prototype/` | 早期静态 HTML 原型，仅作设计参考，不参与构建 |

## 截图

```bash
node scripts/shoot-themes.mjs   # 构建 + vite preview + headless Chrome，输出到 docs/screenshots/themes/
```
