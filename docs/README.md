# Redis Manager 文档索引

基于 Go + [MyGo](https://github.com/egoist/mygo) + React + TypeScript 实现的桌面端 Redis 管理工具（v0.2.x，支持 macOS Universal 与 Windows x64 安装包及签名自动更新）。

前端采用「实例优先」的工作区组织与协议分析台式的扁平、按列对齐界面，提供浅色 / 深色（可跟随系统）双色外观；Go 侧负责连接持久化与系统凭据存储、连接探测、`SCAN` 键空间游标浏览、多类型键值读写、CLI 会话执行、实时指标采集与应用更新。

## 文档导航

| 文档 | 内容 |
|---|---|
| [产品说明](../PRODUCT.md) | 产品定位、工作区结构、当前支持能力与演进边界 |
| [设计系统](../DESIGN.md) | 现行视觉实现：设计 token、排版层级、组件语汇、布局与状态规则 |
| [版本发布与签名更新](releases.md) | macOS / Windows 构建打包、自动更新签名密钥配置与 GitHub Release 发布流程 |
| [产品主页与 Pages 部署](pages.md) | 静态产品主页装配、本地预览、GitHub Actions 部署与自定义域名 |
| [界面截图](screenshots/) | 各核心页面在浅色 / 深色外观下的界面截图 |

本地开发、构建检查与桌面端打包说明见仓库根目录 [README.md](../README.md)。

## 核心功能（v0.2.x）

- **连接管理**：分组组织、Standalone / Sentinel / Cluster 拓扑、ACL 认证、TLS 连接与系统凭据存储
- **实例总览**：QPS、连接数、内存占用、PING 延迟等核心 KPI；实时吞吐曲线；诊断提示；热门命令统计与键空间分布
- **键浏览器**：基于 `SCAN` 的游标分页与前缀分组树；String / Hash / List / Set / ZSet / Stream 查看、格式化预览与编辑
- **CLI 控制台**：多会话切换、命令历史、语法提示与补全、只读模式保护、阻塞及高危命令拦截
- **实时监控**：吞吐与内存/网络趋势、主从及节点拓扑、慢查询（`SLOWLOG`）、客户端列表、`INFO` 详情与操作/事件时间线
- **设置与全局导航**：浅色 / 深色 / 跟随系统外观、`SCAN` 默认参数、危险命令二次确认、凭据存储策略，以及 `⌘K` / `Ctrl+K` 全局命令面板
