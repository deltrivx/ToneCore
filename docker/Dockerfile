# ---------- Stage 1: 构建前端 ----------
FROM node:22-alpine AS web-builder
WORKDIR /app
# 依赖清单单独 COPY，使依赖层缓存只随依赖变化而失效。
# 版本号在 package.json 里，一旦改版本就会打断这一层 —— 所以发版时
# **不要改 package.json 的 version**（详见下方 server-builder 的说明）。
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
RUN npm ci --workspace=apps/web --include-workspace-root --no-audit --no-fund
COPY apps/web ./apps/web
RUN npm run build -w apps/web

# ---------- Stage 2: 构建后端 ----------
# Node 22 = ABI 127。better-sqlite3 12.x 为 ABI 127 提供官方 musl 预编译产物
# （linuxmusl-x64 / linuxmusl-arm64），正常情况下直接下载，无需源码编译。
# 注意：Node 20（ABI 115）已被上游放弃预编译，一旦用它就会退回 QEMU 下
# 源码编译，构建会长时间卡住 —— 这是本文件锁定 22 的原因，勿降级。
FROM node:22-alpine AS server-builder

# 工具链仅作兜底：预编译下载失败时源码编译不会因缺依赖而中断。
# 这些工具只存在于本阶段，运行镜像里不会带上（见 Stage 3）。
RUN apk add --no-cache python3 make g++ sqlite-dev

WORKDIR /app
# ⚠️ 发版时不要改 package.json / package-lock.json 里的 version 字段。
#
# 原因：本层是 `COPY package*.json`，Docker 按**文件内容**算层缓存键。
# 版本号一改，这层必然失效，紧接着的 `npm ci` 就要在 arm64 的 QEMU 下
# 把整棵依赖树（含 better-sqlite3 的原生模块）从头装一遍。
# 实测对比：缓存命中 3 分 38 秒，缓存失效 40 分钟以上。
#
# 而镜像里的版本号**根本不由这里决定** —— 它来自构建参数 TONECORE_VERSION
# （见 Stage 3），运行时由 apps/server/src/version.ts 读取。
# 所以 package.json 的 version 对镜像只是元信息，改它纯属自伤缓存。
COPY package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/
RUN npm ci --workspace=apps/server --include-workspace-root --no-audit --no-fund
COPY apps/server ./apps/server
RUN npm run build -w apps/server

# 只保留生产依赖（npm workspaces 会提升到根 node_modules）
ENV NODE_ENV=production
RUN npm prune --omit=dev --include-workspace-root


# 原生模块自检：预编译产物若有问题（缺失/ABI 不符/架构错），
# 在这里就失败，而不是等容器跑起来在首次查询曲库时崩。
RUN node -e "require('better-sqlite3')(':memory:').close()" \
    && echo "better-sqlite3 自检通过"

# ---------- Stage 3: 运行镜像 ----------
FROM node:22-alpine
LABEL org.opencontainers.image.title="ToneCore"
LABEL org.opencontainers.image.description="一体化音乐中枢 · 音源搜索 / 无损落库 / 自动刮削 / 小爱音箱接入"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.url="https://github.com/deltrivx/ToneCore"
LABEL org.opencontainers.image.source="https://github.com/deltrivx/ToneCore"
LABEL org.opencontainers.image.documentation="https://github.com/deltrivx/ToneCore#readme"

# ffmpeg 用于音频校验/转码，sqlite 库供 better-sqlite3 运行时链接
RUN apk add --no-cache tini ffmpeg tzdata sqlite-libs \
    && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
    && echo "Asia/Shanghai" > /etc/timezone \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# 版本号注入：让 /api/health 与控制台徽章显示的版本与镜像标签一致，
# 避免「镜像换版本了、界面还显示旧号」。
ARG TONECORE_VERSION=0.0.0
ENV NODE_ENV=production \
    TONECORE_VERSION=${TONECORE_VERSION} \
    MUSIC_DIR=/music \
    DATA_DIR=/data \
    PORT=8090

# 后端（编译产物 + 生产依赖），依赖已提升到根目录
COPY --from=server-builder /app/apps/server/dist ./server
COPY --from=server-builder /app/node_modules ./node_modules
COPY --from=server-builder /app/package.json ./package.json

# 前端静态资源
COPY --from=web-builder /app/apps/web/dist ./public

# 图标：Unraid 模板与文档引用，同时由 /icon.png 对外提供
COPY assets/icon.png ./public/icon.png

# 音源脚本目录（可挂载 /data 覆盖）
RUN mkdir -p /data/sources /music

VOLUME ["/music", "/data"]
EXPOSE 8090

# wget 来自 busybox，Alpine 基础镜像自带
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8090/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/index.js"]
