# 开发指南

## 环境要求

- Node.js >= 20
- npm（仓库使用 npm workspaces）

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
│       ├── version.ts         # 版本号唯一出处
│       ├── config.ts          # 配置加载（环境变量 > yaml > 默认值）
│       ├── services/
│       │   ├── source/        # 音源引擎（脚本加载 + 搜索 + 取链 + 健康度）
│       │   ├── search/        # 各平台自研搜索 + 酷我直连取链
│       │   ├── download/      # 下载落库（队列 + 校验 + 归档 + 触发刮削）
│       │   ├── scraper/       # 标签 / 封面 / 歌词读写
│       │   │   ├── index.ts   #   刮削编排
│       │   │   ├── tags.ts    #   ID3 / Vorbis Comment 写入
│       │   │   └── lyrics.ts  #   歌词与封面抓取
│       │   ├── speaker/       # 小爱接入（MiIO + Mina 协议、指令解析）
│       │   └── library/       # 曲库索引（SQLite）
│       ├── routes/            # HTTP 路由
│       └── orchestrator.ts    # 点歌编排 + 播放上下文
├── server/test/         # 测试
└── web/                 # 前端 Vue 3 + Tailwind
```

## 关键流程

点歌 (`POST /api/play`)：

1. 本地曲库检索 → 命中直接返回 `/stream/...`
2. 未命中 → 音源引擎跨平台搜索 + 统一打分选源 + 取直链
3. **异步**入队下载（不阻塞播放返回）
4. 下载完成 → 写入 `/music/{artist}/{album}/{title}`
5. 落库后触发刮削：写标签、嵌封面、写歌词

语音点歌比上述多一步：`Orchestrator` 会把本次点歌的上下文（歌名、歌手、
候选队列）按设备记住，供后续「上一首 / 下一首」使用 —— 音箱本身没有播放列表概念。

## 配置优先级

`环境变量 > /data/config.yaml > 内置默认值`

新增容器模板变量时，需要在 `config.ts` 的 `envOverrides()` 与 `lockedByEnv()`
两处同步登记，否则会出现「模板里改了不生效」或「锁定提示漏报」。

## 测试

```bash
npm test
```

当前覆盖音频标签写入（`apps/server/test/tags.test.mjs`）：构造最小 FLAC，
校验标签写入后可被正确解析、重复写入为覆盖语义、封面嵌入正确、
音频帧未被破坏，以及非法输入不会破坏原文件。

> FLAC 的标签写入是手写的二进制逻辑 —— 类型检查通过不代表字节结构正确，
> 改动 `tags.ts` 后务必跑这个测试。

## 构建镜像

```bash
docker build -f docker/Dockerfile -t tonecore:dev .
```

> 发布镜像由 GitHub Actions 构建（推送到 `main` 或 `v*` 标签时触发），
> 本地构建只用于验证。

## 发版

1. 更新 `apps/server/src/version.ts` 中的 `VERSION_DEFAULT`
2. 在 `CHANGELOG.md` 追加本次变更（新增 / 修复 / 变更分类）
3. 新建 `docs/release-notes/v<版本>.md` 作为发布说明
4. 提交并推送 `main`（触发镜像构建）
5. 打并推送 `v<版本>` 标签，产出带版本号的镜像标签
6. 以发布说明为内容创建 GitHub Release

版本号只允许在 `version.ts` 一处定义，`/api/health` 与控制台均从那里取。
