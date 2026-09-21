# 部署指南

## Docker 一键部署

```bash
docker run -d \
  --name ToneCore \
  --restart unless-stopped \
  -p 8090:8090 \
  -e TZ=Asia/Shanghai \
  -v /your/music:/music \
  -v /your/appdata/tonecore:/data \
  ghcr.io/deltrivx/tonecore:latest
```

## Docker Compose

见 [docker/docker-compose.yml](../docker/docker-compose.yml)。

```bash
docker compose up -d
```

## Unraid

方式一（推荐）：容器模板。

1. Docker → Add Container
2. 在 Template 处填入模板地址：
   `https://raw.githubusercontent.com/deltrivx/ToneCore/main/docker/tonecore.xml`
3. 按需调整路径与参数后应用

模板已预置端口、音乐库 / 数据目录、时区，以及音质、自动落库、标签、歌词、
并发、日志级别等环境变量。

方式二：手工填表，Repository 填 `ghcr.io/deltrivx/tonecore:latest`，
端口 `8090`，路径 `/mnt/user/music` → `/music`、`/mnt/user/appdata/tonecore` → `/data`。

> **更新已有容器请走模板机制**（Docker 页面点「重建 / 更新」，或执行
> `/usr/local/emhttp/plugins/dynamix.docker.manager/scripts/update_container ToneCore`）。
> 不要 `docker rm` 后再 `docker run` 手工重建 —— 那会丢失 Unraid 注入的
> 管理标签，容器会掉进「第三方」区且模板失效。

## 目录说明

| 路径 | 用途 |
|---|---|
| `/music` | 音乐库（你的曲库，其余应用也可共享） |
| `/data` | 配置、数据库、音源脚本 |
| `/data/sources/` | 音源脚本（`.js`） |
| `/data/_disabled/` | 被停用的音源 |
| `/data/_trash/` | 删除的曲目与音源（按月份归档，可手工找回） |
| `/data/tonecore.db` | 曲库索引与落库记录 |
| `/data/config.yaml` | 运行参数 |

## 配置优先级

**环境变量 > `/data/config.yaml` > 内置默认值**。

在容器模板或 compose 中设置的变量优先级最高 —— 界面上对同一字段的修改不会生效，
设置页会把这类字段列出来提示。要改这些值，请改模板 / compose 后重建容器。

## 首次启动

1. 访问 `http://<IP>:8090`
2. 「设置」里确认落库策略、音质、标签与歌词开关
3. 「曲库」点「扫描」建立索引
4. 「音源」确认脚本已加载（把 `.js` 音源放进 `/data/sources/`）
5. 「设置 → 小爱音箱接入」填写小米账号密码登录，勾选监听开关

## 反向代理与域名

音箱需要一个它**能访问到**的地址来拉流。若通过反向代理对外提供，
需保证 `/stream` 与 `/proxy` 两个路径可被音箱访问。

> 注意：音箱拉流走的是**内网直连**。除非内网 DNS 能正确解析，否则不要只填
> 公网域名 —— 音箱解析不到就播不出声。

## 健康检查

```bash
curl http://127.0.0.1:8090/api/health
```

返回中包含 `version`（镜像版本）、`sources`（音源脚本数）、
`library`（曲库数量）、`queue`（下载队列）与 `speaker`（音箱接入状态）。
