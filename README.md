<div align="center">

<img src="assets/icon.png" alt="ToneCore" width="160" height="160" />

# ToneCore

**一体化音乐中枢 · 音色核心**

内置播放器 · 音源搜索 · 无损落库 · 自动刮削 · 小爱音箱接入

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/docker-ready-2496ED.svg?logo=docker&logoColor=white)](docker/)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933.svg?logo=nodedotjs&logoColor=white)](package.json)
[![Platform](https://img.shields.io/badge/platform-amd64%20%7C%20arm64-lightgrey.svg)](docker/)
[![Image](https://img.shields.io/badge/image-ghcr.io-2496ED.svg)](https://github.com/deltrivx/ToneCore/pkgs/container/tonecore)

</div>

---

## ✨ 这是什么

ToneCore 是你**自己的音乐中枢**：既能把「想听的歌」送到小爱音箱，
也能直接在浏览器里听 —— 播放器、曲库、歌词、封面都在里面。

你说「播放本草纲目」，或在界面里点一下，它自动：

1. 先查本地曲库 → 有就直接播
2. 没有 → 全网找音源，取无损直链
3. 推给音箱播放（**秒播，不等下载**），或在浏览器里直接试听
4. **后台异步下载**到本地，自动写好标签、封面、歌词
5. 下次再听这首歌，直接本地播放，无网也能听

---

## 🚀 核心能力

| 能力 | 说明 |
|---|---|
| ▶️ **内置播放器** | 播放队列、上一首/下一首、进度拖动、音量、三种循环模式 |
| 🎵 **歌词与封面** | LRC 滚动歌词 + 专辑封面，本地内嵌与在线双来源 |
| 🎤 **设备接入** | 小爱音箱语音点歌，对话轮询 + 意图解析 |
| 🎛️ **播放控制** | 上一首 / 下一首 / 暂停 / 继续 / 停止，音量绝对与相对调节 |
| 🔍 **音源引擎** | 多平台并发搜歌，跨平台统一打分选源、失败降级 |
| 💾 **无损落库** | 点播自动下载 FLAC/320K，按 `歌手/专辑/歌名` 归档 |
| 🏷️ **自动刮削** | 嵌入 ID3/FLAC 标签、封面、歌词，支持对已有曲库批量补全 |
| 📚 **本地曲库** | SQLite 索引，检索 / 分页 / 试听 / 统计，删除走回收站 |
| 🎛️ **侧边栏控制台** | 深色科技风，桌面常驻侧边栏 / 移动抽屉式，双端适配 |

### 为什么音源要「统一打分」而不是「按平台顺序」

同一个关键词在各平台的搜索结果质量差异很大 —— 某些平台的搜索结果可能全是翻唱。
ToneCore 把各平台候选放在一起，按标题相似度、歌手匹配度、版本噪音词
（伴奏 / DJ / 翻唱 / 现场等）综合评分，分数高的优先取链；
并设有分数下限，宁可返回失败也不降级到翻唱，避免「点错歌」。

---

## 🏗️ 架构

```
[小爱音箱] ──语音──> [小米云端]
   ▲                      │
   │                      ▼
   │             [ToneCore 对话监听]
   │                      │
   │                      ▼
   │             [本地曲库预检]
   │             ├─ 命中 → 直接推流
   │             └─ 未命中 ↓
   │                      ▼
   │             [音源引擎并发调度]
   ├── 推流播放 ◀─────────┤ (异步解耦，秒播)
   │                      ▼
   │             [下载 · 打标签 · 落库]
   ▼                      ▼
音箱播放           /music/{歌手}/{专辑}/{歌名}.flac
```

---

## 📦 快速开始

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

打开 `http://<你的IP>:8090` 完成初始化。

---

## ⚙️ 配置

优先级为 **环境变量 > `/data/config.yaml` > 内置默认值**。
在容器模板或 compose 里设置的变量会覆盖界面上的改动 ——
被环境变量锁定的字段会在设置页显式提示，避免「改了没反应」却找不到原因。

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8090` | 控制台端口 |
| `MUSIC_DIR` | `/music` | 音乐库根目录 |
| `DATA_DIR` | `/data` | 配置、数据库、音源脚本 |
| `QUALITY` | `flac` | 目标音质：`master` / `flac24bit` / `flac` / `320k` / `128k` |
| `AUTO_FETCH` | `true` | 点播是否自动落库 |
| `EMBED_METADATA` | `true` | 是否嵌入标签与封面 |
| `WRITE_LYRICS` | `true` | 是否写入歌词 |
| `DOWNLOAD_CONCURRENCY` | `1` | 下载并发（建议保持 1） |
| `DOWNLOAD_INTERVAL_MS` | `3000` | 下载任务间隔，防风控 |
| `PATH_TEMPLATE` | `{artist}/{album}/{title}` | 落盘路径模板 |
| `PLATFORMS` | `kw,tx,wy` | 平台优先级（按实际可用性排列） |
| `LOG_LEVEL` | `info` | `trace` / `debug` / `info` / `warn` / `error` |

> 咪咕与酷狗因上游接口失效已下线，配置里写了也会被忽略，
> 接口响应会明确标注，避免被误读成「搜索坏了」。

---

## 📖 文档

- [部署指南](docs/deploy.md)
- [音源管理](docs/sources.md)
- [开发指南](docs/development.md)
- [更新日志](CHANGELOG.md) · [版本发布](RELEASES.md)

---

## 📜 许可与致谢

Apache-2.0

本项目整合了以下优秀开源项目的核心能力（详见 [NOTICE](NOTICE)）：

- [SongLoft](https://github.com/songloft-org/songloft) — 曲库管理 · 插件体系
- [RoMusic](https://github.com/leizi914599611-boop/ro) — 音源解析 · 下载落库
- [songloft-plugin-miot](https://github.com/songloft-org/songloft-plugin-miot) — 小爱音箱协议

第三方音源脚本版权归各自作者所有。
