# Redis Manager

Go + [MyGo](https://github.com/egoist/mygo) 实现的 Redis 桌面管理工具。

当前阶段：**macOS 首个可运行版本**。前端已重写为「一套页面 + 四套主题」的结构（Console / Terminal / Craft / Airy），
Go 侧提供连接保存、测试、SCAN、值读取、CLI 和指标服务。

| 文档 | 内容 |
|---|---|
| [主题系统](themes.md) | 现行实现：token 契约、结构轴、四套主题截图、如何新增主题 |
| [主题截图](screenshots/themes/) | 四套主题在实际应用中的截图 |
| [风格选择页](../prototype/styles/index.html) | 早期静态原型入口（设计参考，不参与构建） |
| [四套风格对比](styles.md) | 早期原型的视觉语言与取舍记录 |
| [UI 原型设计说明](ui-prototype.md) | MyGo 两种界面形态对比与选型、信息架构、视觉规范、各页面设计、交互约定、Go 代码结构建议、安全与性能要点 |
| [主原型](../prototype/index.html) | 第 1 版高保真原型，深/浅色可切换 |
| [设计稿截图](screenshots/) | 各页面截图；四套风格在 `screenshots/styles/` |

构建和 macOS 打包说明见仓库根目录 [README.md](../README.md)。

## 功能范围（原型已覆盖）

- 连接管理：分组、Standalone / Sentinel / Cluster、ACL、TLS、SSH 隧道、系统钥匙串存密码
- 服务器总览：QPS、连接数、内存、延迟 KPI；吞吐曲线；告警建议；热门命令；键空间分布
- 键浏览：SCAN 分页 + 前缀分组；String / Hash / List / Set / ZSet / Stream 各类型编辑
- CLI 控制台：多会话、历史、补全、只读保护、阻塞命令拦截
- 监控：实时吞吐、内存/网络、主从拓扑、慢查询、客户端列表、INFO；操作/事件时间线
- 设置：主题、SCAN 参数、危险命令二次确认、凭据存储
- 全局：⌘K 命令面板、应用锁屏（Console / Airy）
