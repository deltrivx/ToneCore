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

## Unraid

1. Docker → Add Container
2. Repository: `ghcr.io/deltrivx/tonecore:latest`
3. 端口: `8090`
4. 路径: `/mnt/user/music` → `/music`，`/mnt/user/appdata/tonecore` → `/data`

## 目录说明

| 路径 | 用途 |
|---|---|
| `/music` | 音乐库（你的曲库，其余应用也可共享） |
| `/data` | 配置、数据库、音源脚本 |

## 首次启动

1. 访问 `http://<IP>:8090`
2. 「设置」里确认落库策略
3. 「曲库」点「扫描」建立索引
4. 「音源」确认脚本已加载（把 `.js` 音源放进 `/data/sources/`）
