# 产品主页（GitHub Pages）

主页是独立的静态站点，放在 `site/`，不参与桌面应用的构建，也不会把 `docs/` 里的设计资料发布出去。

## 本地预览

```bash
bun run preview:site
```

打开 `http://localhost:4173`。脚本会先把 `site/`、`docs/screenshots/` 与应用图标组装到 `_site/`，再启动静态服务。

## 部署

`.github/workflows/pages.yml` 在 `main` 分支有 `site/` 相关变更时自动构建并部署到 GitHub Pages，也可以在 Actions 页面手动运行。

首次使用需要在仓库 **Settings → Pages → Build and deployment → Source** 中选择 **GitHub Actions**。

站点地址：

```text
https://duanyongcheng.github.io/redis-manager/
```

## 自定义域名

1. 在 `site/` 新建 `CNAME` 文件，内容为域名（构建时会原样复制到 `_site/`）。
2. DNS 配置 `CNAME` 指向 `duanyongcheng.github.io`。
3. 在 Settings → Pages → Custom domain 保存域名，等待证书签发后勾选 **Enforce HTTPS**。

页面中的资源全部使用相对路径，项目页路径前缀与自定义根域名两种部署方式都能工作。

## 维护

- 截图来自 `docs/screenshots/`，更新截图后重新推送即可。
- `site/assets/overview-analyser-{light,dark}.png` 是从总览截图裁出的局部图；总览界面变化时需要同时重新生成。
- 下载按钮指向当前版本 `v0.3.0` 的 Release 资产；发布新版本时同步更新 `site/index.html` 中的版本号与资产文件名。
