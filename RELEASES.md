# 版本发布

本文件记录各版本的发布信息与镜像标签对应关系。详细的逐版本变更见 [CHANGELOG](CHANGELOG.md)，
单个版本的发布说明见 [`docs/release-notes/`](docs/release-notes/)。

## 镜像标签约定

镜像发布到 GitHub Container Registry：`ghcr.io/deltrivx/tonecore`

| 标签 | 说明 | 更新方式 |
|---|---|---|
| `latest` | 最新发布版本 | 推 `v*` 标签时生成（分支构建不写 `latest`） |
| `0.2.0` | 语义化版本号 | 推 `v0.2.0` 标签时生成 |
| `0.2` | 次版本号 | 同上 |

> **注意**：`latest` 只由版本标签构建生成，不跟随 `main` 分支的中间提交。
> 生产环境建议固定到具体的版本号标签。

## 版本列表

| 版本 | 日期 | 镜像标签 | 说明 |
|---|---|---|---|
| [0.14.0](docs/release-notes/v0.14.0.md) | 2026-09-28 | `ghcr.io/deltrivx/tonecore:0.14.0` | 修密码哈希与鉴权误报；改为自主认证；清理冗余文案 |
| [0.13.0](docs/release-notes/v0.13.0.md) | 2026-09-28 | `ghcr.io/deltrivx/tonecore:0.13.0` | 关于移到底部；音箱配置完整复刻 SongLoft MIoT |
| [0.12.0](docs/release-notes/v0.12.0.md) | 2026-09-28 | `ghcr.io/deltrivx/tonecore:0.12.0` | 界面体系重构：矢量图标 / 单入口导航 / 设计 token |
| [0.11.7](docs/release-notes/v0.11.7.md) | 2026-09-23 | `ghcr.io/deltrivx/tonecore:0.11.7` | 修复 tag 构建时 `latest` 标签缺失 |
| [0.11.6](docs/release-notes/v0.11.6.md) | 2026-09-23 | `ghcr.io/deltrivx/tonecore:0.11.6` | 修复 Subsonic 取流 502（路径分隔符被整体编码） |
| [0.11.5](docs/release-notes/v0.11.5.md) | 2026-09-23 | `ghcr.io/deltrivx/tonecore:0.11.5` | 修复前端整体白屏（进度上报函数被摇树移除） |
| [0.11.4](docs/release-notes/v0.11.4.md) | 2026-09-23 | `ghcr.io/deltrivx/tonecore:0.11.4` | 修复 Subsonic 取流 404（重定向到不存在的端点） |
| [0.11.3](docs/release-notes/v0.11.3.md) | 2026-09-23 | `ghcr.io/deltrivx/tonecore:0.11.3` | 补提交 CI workflow，修复镜像版本号错为 `main` |
| [0.11.2](docs/release-notes/v0.11.2.md) | 2026-09-23 | `ghcr.io/deltrivx/tonecore:0.11.2` | 镜像内版本号错成 `main` |
| [0.11.1](docs/release-notes/v0.11.1.md) | 2026-09-23 | `ghcr.io/deltrivx/tonecore:0.11.1` | 升级前创建的账号无法使用 Subsonic 令牌认证 |
| [0.11.0](docs/release-notes/v0.11.0.md) | 2026-09-23 | `ghcr.io/deltrivx/tonecore:0.11.0` | Subsonic REST API 兼容层 `/rest/*` |
| [0.10.0](docs/release-notes/v0.10.0.md) | 2026-09-23 | `ghcr.io/deltrivx/tonecore:0.10.0` | 账号认证 |
| [0.9.0](docs/release-notes/v0.9.0.md) | 2026-09-23 | `ghcr.io/deltrivx/tonecore:0.9.0` | 音源「停用」后卡片直接消失 |
| [0.8.1](docs/release-notes/v0.8.1.md) | 2026-09-22 | `ghcr.io/deltrivx/tonecore:0.8.1` | 酷我专辑维度返回空 |
| [0.8.0](docs/release-notes/v0.8.0.md) | 2026-09-22 | `ghcr.io/deltrivx/tonecore:0.8.0` | 云端搜索三种检索维度 |
| [0.7.1](docs/release-notes/v0.7.1.md) | 2026-09-22 | `ghcr.io/deltrivx/tonecore:0.7.1` | 音源「测试」按钮恒定失败 |
| [0.7.0](docs/release-notes/v0.7.0.md) | 2026-09-22 | `ghcr.io/deltrivx/tonecore:0.7.0` | 播放不再占用主页版面 |
| [0.6.2](docs/release-notes/v0.6.2.md) | 2026-09-22 | `ghcr.io/deltrivx/tonecore:0.6.2` | 音源测试硬取 `platforms[0]` 导致假阴性误报 |
| [0.6.1](docs/release-notes/v0.6.1.md) | 2026-09-22 | `ghcr.io/deltrivx/tonecore:0.6.1` | 脚本 init 等待窗口过短（500ms），新版音源被误判加载失败 |
| [0.6.0](docs/release-notes/v0.6.0.md) | 2026-09-22 | `ghcr.io/deltrivx/tonecore:0.6.0` | 清理已删除文件残留的曲目 |
| [0.5.1](docs/release-notes/v0.5.1.md) | 2026-09-22 | `ghcr.io/deltrivx/tonecore:0.5.1` | 歌单删除 / 移除曲目 400 |
| [0.5.0](docs/release-notes/v0.5.0.md) | 2026-09-22 | `ghcr.io/deltrivx/tonecore:0.5.0` | 主页 / 曲库 / 音源 / 设置 |
| [0.4.0](docs/release-notes/v0.4.0.md) | 2026-09-22 | `ghcr.io/deltrivx/tonecore:0.4.0` | 播放页整合进音乐库 |
| [0.3.0](docs/release-notes/v0.3.0.md) | 2026-09-22 | `ghcr.io/deltrivx/tonecore:0.3.0` | 音源取链全部 30s 超时（致命） |
| [0.2.0](docs/release-notes/v0.2.0.md) | 2026-09-21 | `ghcr.io/deltrivx/tonecore:0.2.0` | 自带完整播放器 |
| [0.1.0](docs/release-notes/v0.1.0.md) | 2026-09-23 | `ghcr.io/deltrivx/tonecore:0.1.0` | 无头音乐中枢 |

## 升级方式

Docker Compose：

```bash
docker compose pull && docker compose up -d
```

Unraid：在 Docker 页面选中 ToneCore，点击「重建」（或改用 `update_container` 脚本）。

> 数据目录 `/data` 与音乐库 `/music` 均为挂载卷，升级容器不会影响已有数据。

## 发布流程

1. 确认 `apps/server/src/version.ts` 中的版本号已更新
2. 在 `CHANGELOG.md` 中补充本次变更
3. 新建 `docs/release-notes/v<版本>.md` 作为发布说明
4. 提交并推送 `main`
5. 创建并推送 `v<版本>` 标签，触发镜像构建
6. 在 GitHub Releases 中以发布说明为内容创建 Release

> 镜像由 GitHub Actions 构建（`.github/workflows/docker.yml`），
> 不在本地执行 `docker build` 后推送。
