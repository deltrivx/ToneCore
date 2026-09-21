<div align="center">

<img src="assets/icon.png" alt="ToneCore" width="160" height="160" />

# ToneCore

**一体化音乐中枢 · 音色核心**

音源搜索 · 无损落库 · 自动刮削 · 小爱音箱接入 —— 单镜像开箱即用

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/docker-ready-2496ED.svg?logo=docker&logoColor=white)](docker/)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933.svg?logo=nodedotjs&logoColor=white)](package.json)
[![Platform](https://img.shields.io/badge/platform-amd64%20%7C%20arm64-lightgrey.svg)](docker/)

</div>

---

## ✨ 这是什么

ToneCore 是一个**无头音乐中枢**。它不做播放器 UI，只做一件事：

> **让小爱音箱想听什么就听什么，并且听完自动进你的本地曲库。**

你说「播放本草纲目」，它自动：

1. 先查本地曲库 → 有就直接播
2. 没有 → 全网找音源，取无损直链
3. 推给音箱播放（**秒播，不等下载**）
4. **后台异步下载**到本地，自动写好标签、封面、歌词
5. 下次再点这首歌，直接本地播放

---

## 🚀 核心能力

| 能力 | 说明 |
|---|---|
| 🎤 **设备接入** | 小爱音箱语音点歌，对话轮询 + 意图解析 |
| 🔍 **音源引擎** | 多平台并发搜歌，自动打分选源、失败降级 |
| 💾 **无损落库** | 点播自动下载 FLAC/320K，按 `歌手/专辑/歌名` 归档 |
| 🏷️ **自动刮削** | 嵌入 ID3/FLAC 标签、封面、歌词 |
| 🎛️ **极简控制台** | 深色科技风，PC / 移动双端适配 |

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
  -p 8090:8090 \
  -v /your/music:/music \
  -v /your/appdata/tonecore:/data \
  ghcr.io/deltrivx/tonecore:latest
```

打开 `http://<你的IP>:8090` 完成初始化。

---

## 📖 文档

- [部署指南](docs/deploy.md)
- [音源管理](docs/sources.md)
- [开发指南](docs/development.md)

---

## 📜 许可与致谢

Apache-2.0

本项目整合了以下优秀开源项目的核心能力（详见 [NOTICE](NOTICE)）：

- [SongLoft](https://github.com/songloft-org/songloft) — 曲库管理 · 插件体系
- [RoMusic](https://github.com/leizi914599611-boop/ro) — 音源解析 · 下载落库
- [songloft-plugin-miot](https://github.com/songloft-org/songloft-plugin-miot) — 小爱音箱协议

第三方音源脚本版权归各自作者所有。
