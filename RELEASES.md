# 版本发布

本文件记录各版本的发布信息与镜像标签对应关系。详细的逐版本变更见 [CHANGELOG](CHANGELOG.md)，
单个版本的发布说明见 [`docs/release-notes/`](docs/release-notes/)。

## 镜像标签约定

镜像发布到 GitHub Container Registry：`ghcr.io/deltrivx/tonecore`

| 标签 | 说明 | 更新方式 |
|---|---|---|
| `latest` | 默认分支最新构建 | 随 `main` 分支提交自动更新 |
| `0.1.0` | 语义化版本号 | 推 `v0.1.0` 标签时生成 |
| `0.1` | 次版本号 | 同上 |

> **注意**：`latest` 跟随 `main` 分支，可能包含尚未发布的改动。
> 生产环境建议固定到具体的版本号标签。

## 版本列表

| 版本 | 日期 | 镜像标签 | 说明 |
|---|---|---|---|
| [0.1.0](docs/release-notes/v0.1.0.md) | 2026-09-21 | `ghcr.io/deltrivx/tonecore:0.1.0` | 首个版本 |

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
