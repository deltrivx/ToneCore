# 开发指南

## 环境要求

- Node.js >= 20
- npm 或 pnpm

## 本地开发

```bash
npm install

# 后端（热重载）
npm run dev

# 前端（Vite，:5173，已配代理到 :8090）
npm run dev -w apps/web
```

## 目录结构

```
apps/
├── server/              # 后端
│   └── src/
│       ├── services/
│       │   ├── source/        # 音源引擎（脚本加载 + 搜索 + 取链）
│       │   ├── download/      # 下载落库（队列 + 校验 + 归档）
│       │   ├── scraper/       # 元数据读取
│       │   ├── speaker/       # 小爱接入
│       │   └── library/       # 曲库索引
│       ├── routes/            # HTTP 路由
│       └── orchestrator.ts    # 点歌编排
└── web/                 # 前端 Vue 3 + Tailwind
```

## 关键流程

点歌 (`POST /api/play`)：
1. 本地曲库检索 → 命中直接返回 `/stream/...`
2. 未命中 → 音源引擎搜索 + 打分选源 + 取直链
3. **异步**入队下载（不阻塞播放返回）
4. 下载完成 → 写入 `/music/{artist}/{album}/{title}`

## 构建镜像

```bash
docker build -f docker/Dockerfile -t tonecore:dev .
```
