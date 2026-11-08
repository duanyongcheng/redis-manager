# GitHub 发布与应用更新

项目通过 [release.yml](../.github/workflows/release.yml) 在推送版本标签时构建两个安装包：

- **macOS 通用版**：一个 DMG 同时包含 Apple Silicon 和 Intel 的程序，使用 `darwin-universal` 更新通道。
- **Windows x64**：NSIS 安装程序，使用 `windows-amd64` 更新通道。

两端均构建成功、更新包校验通过后，工作流才会把 Release 从草稿发布为正式版本。应用从公开仓库 `duanyongcheng/redis-manager` 的最新正式 Release 获取更新，不需要在客户端保存 GitHub Token。

## 一次性配置

### 1. 生成并保管更新签名密钥

在本机仓库根目录安装依赖，然后把密钥生成到源码目录之外。以下为 macOS 示例：

```bash
bun install --frozen-lockfile

REDIS_MANAGER_UPDATE_KEYS_DIR="$HOME/Library/Application Support/Redis Manager/update-keys"
node node_modules/mygo-cli/bin/mygo.js keygen -o "$REDIS_MANAGER_UPDATE_KEYS_DIR"
```

生成的文件：

| 文件 | 用途 |
| --- | --- |
| `mygo-update.pub` | 公钥，编入应用，用来校验下载的更新 |
| `mygo-update.key` | 私钥，只用于构建时签署更新包 |

备份这对密钥，后续版本持续使用同一对。已安装的应用只信任它内置的公钥；随意重新生成或更换密钥会让旧版拒绝新更新。`keygen` 默认拒绝覆盖已有文件。

### 2. 配置 GitHub 仓库变量和 Secret

在仓库 **Settings → Secrets and variables → Actions** 中配置：

| 类型 | 名称 | 值 |
| --- | --- | --- |
| Repository variable | `MYGO_UPDATER_PUBLIC_KEY` | `mygo-update.pub` 的文件内容 |
| Repository secret | `MYGO_UPDATER_PRIVATE_KEY` | `mygo-update.key` 的文件内容 |

已经登录 GitHub CLI 时，也可以在上一步的同一终端中执行：

```bash
gh variable set MYGO_UPDATER_PUBLIC_KEY --repo duanyongcheng/redis-manager \
  < "$REDIS_MANAGER_UPDATE_KEYS_DIR/mygo-update.pub"

gh secret set MYGO_UPDATER_PRIVATE_KEY --repo duanyongcheng/redis-manager \
  < "$REDIS_MANAGER_UPDATE_KEYS_DIR/mygo-update.key"
```

`MYGO_UPDATER_PUBLIC_KEY` 由本项目的 [mygo.config.ts](../mygo.config.ts) 读取。私钥环境变量由 MyGo 在签名时读取；私钥不会进入发布产物或应用。源码的忽略规则也排除了 `mygo-update.key`、`.p12` 和 `.pfx` 文件。

工作流使用 GitHub 自动提供的 `GITHUB_TOKEN`：构建任务只有读取权限，最终发布任务才申请 `contents: write`。不需要额外配置个人访问令牌。如果组织策略限制 Actions 发布 Release，需要在仓库或组织策略中允许此工作流的写权限。

### 3. 提交工作流和更新功能

确保当前的应用更新代码、配置、工作流和发布脚本已经提交并推送到仓库。配置好上面两个值后再推送版本标签；缺失密钥、密钥不匹配或更新产物缺失都会让发布失败，不会生成一个缺少更新能力的正式 Release。

## 发布一个版本

版本号唯一来源是 `mygo.config.ts` 中的 `version`。例如下一次准备发布 `0.2.0`：

1. 把 `version` 改为 `"0.2.0"`。
2. 在 [CHANGELOG.md](../CHANGELOG.md) 中添加非空的 `## 0.2.0` 段落。该段内容同时出现在 Release 页面和应用更新窗口。
3. 完成项目检查，提交并推送代码，然后推送对应标签。

```bash
bun run checks
bun run test:release
bun run test:previews

git add mygo.config.ts CHANGELOG.md
git commit -m "chore: release 0.2.0"
git push origin main
git tag v0.2.0
git push origin v0.2.0
```

如果首个公开版本沿用当前 `0.1.0`，版本、日志段落和标签分别使用 `0.1.0`、`## 0.1.0`、`v0.1.0`。首次发布没有历史基线，因此不会有差分包。

在 GitHub 的 **Actions → Release** 查看结果。当前流程仅接受稳定版本 `vX.Y.Z`；预发布标签、标签与配置版本不一致、空更新日志都会被拒绝。

## 构建与发布过程

```text
推送 vX.Y.Z
  ├─ macos-15：macOS universal → DMG + 签名更新包 + 更新清单
  └─ ubuntu-24.04 + NSIS：Windows x64 → 安装 EXE + 签名更新包 + 更新清单
                     ↓ 两端全部通过
      校验版本、文件、签名与下载地址，合并 SHA256SUMS
                     ↓
      上传到草稿 Release，再发布为最新正式版本
```

工作流不让各平台直接执行 `mygo build -upload`，以免多个任务互相覆盖共用的校验和文件。平台产物分别保存为 Actions artifact，最终任务统一校验、汇总并发布。

失败的任务可以重新运行。已有草稿可以继续上传；若草稿里有本次清单之外的文件，需要先核对并移除这些残留产物。已经公开的 Release 不会被脚本覆盖，修正已发布版本应提升版本号。工作流也会拒绝把 `latest` 指回比当前正式版本更低的版本。

## Release 产物

以 `0.2.0` 为例：

| 文件 | 用途 |
| --- | --- |
| `redis-manager-0.2.0.dmg` | macOS 初次安装 |
| `redis-manager-setup-0.2.0-amd64.exe` | Windows x64 初次安装 |
| `redis-manager-0.2.0-darwin-universal.tar.gz` | macOS 完整更新包 |
| `redis-manager-0.2.0-windows-amd64.tar.gz` | Windows 完整更新包 |
| `update-darwin-universal.json` / `update-windows-amd64.json` | 各平台版本、说明和更新包地址 |
| `redis-manager-旧版本-to-0.2.0-平台.delta` | 可用时生成的差分更新包 |
| `SHA256SUMS` | 汇总下载文件的 SHA-256 校验和 |
| `install.sh` / `install.ps1` | MyGo 生成的安装辅助脚本 |

更新包与差分包采用 Ed25519 签名；清单中的 `signature` 是对应文件 SHA-256 摘要的签名，清单 JSON 本身不是独立签名文件。应用会校验签名，并校验差分应用后的文件内容。

## 软件如何更新

带有更新配置的正式构建在启动约 10 秒后检查一次，运行期间默认每天再检查一次；也可在「设置 → 关于」点击「检查更新」。发现新版时显示中文更新窗口，包含版本说明、安装、稍后提醒和跳过该版本选项。

默认由用户点击安装后才下载。更新窗口显示下载进度，完成后可选择重启；也可以在下次启动时使用新版。窗口中的自动下载选项由用户自行启用，不会在代码中强制打开。

增量行为：

- 构建时最多读取最近 3 个可用历史版本的完整更新包并验证签名，生成从旧版到新版的差分包。
- 差分包比完整包更小时才发布。版本过旧、历史下载失败或没有合适基线时，可以只有完整更新包。
- 客户端有匹配版本的差分包时优先下载；若应用文件已被修改、差分校验或应用失败，会回退到完整签名包。
- 保留旧 Release 中的完整更新包，后续构建需要用它们制作差分。macOS 通用版和单架构版是不同的更新通道。

**现有未接入更新功能的旧应用需要手动安装一次新安装包。** 首次启用更新之后，后续新版本才会通过软件内的更新流程送达。macOS 应先将应用复制出只读 DMG；应用需要能写入自身的安装位置。

## 本地开发与验证

没有设置 `MYGO_UPDATER_PUBLIC_KEY` 时，普通开发和本地打包仍可运行，自动更新配置被省略。开发模式始终不执行自动更新。需要本地构建一个能够消费已发布更新的正式应用时，可先设置公钥，再正常打包：

```bash
export MYGO_UPDATER_PUBLIC_KEY="$(cat "$REDIS_MANAGER_UPDATE_KEYS_DIR/mygo-update.pub")"
bun run package:mac:universal
```

仅有公钥时，应用可以验证已发布的更新，但本次构建不会生成带签名的更新包。正式发布应由配置了私钥 Secret 的 GitHub 工作流执行。

```bash
# 发布配置及产物收集的回归测试；使用临时合成密钥，不访问 GitHub
bun run test:release

# 有完整密钥环境时，可在发布前检查版本与日志
RELEASE_TAG=v0.1.0 bun run release:check
```

测试覆盖缺失/不匹配的密钥、版本标签、空日志、缺少平台或安装程序、文件签名与字节数、错误下载 URL、重复产物，以及失败时不发布等路径。

工作流与本地校验可以验证配置、编译和产物完整性；首次真实发布之后，仍需用两个不同版本的应用确认更新提示、下载、安装和重启的完整过程。Windows 的实际运行效果也需要在 Windows 上验收。

## 系统代码签名

更新包签名与系统的发行签名是两件事。目前 macOS 使用 MyGo 默认的 ad-hoc 签名，Windows 安装包没有配置 Authenticode 证书；其他电脑可能显示系统信任提示。

面向广泛分发时，可进一步配置 Apple Developer ID 与公证，或 Windows 代码签名证书。它们分别通过 MyGo 的 `macos.signingIdentity` / `macos.notarize`、`windows.certificate` 或 `windows.signCommand` 设置，不替代也不应更换上述更新签名密钥。

参考：[MyGo 更新机制](https://github.com/egoist/mygo/blob/v0.7.4/docs/updates.md) · [MyGo 更新窗口](https://github.com/egoist/mygo/blob/v0.7.4/docs/plugins/updater.md) · [MyGo GitHub Actions](https://github.com/egoist/mygo/blob/v0.7.4/docs/github-actions.md)
