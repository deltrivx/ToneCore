# ---------- Stage 1: 构建前端 ----------
FROM node:20-alpine AS web-builder
WORKDIR /app
COPY package*.json ./
COPY apps/web/package*.json ./apps/web/
RUN npm ci --workspace=apps/web --include-workspace-root --no-audit --no-fund
COPY apps/web ./apps/web
RUN npm run build -w apps/web

# ---------- Stage 2: 构建后端 ----------
FROM node:20-alpine AS server-builder

# better-sqlite3 是原生模块，Alpine 下需要编译工具链。
# 这些工具只存在于本阶段，运行镜像里不会带上（见 Stage 3）。
RUN apk add --no-cache python3 make g++ sqlite-dev

WORKDIR /app
COPY package*.json ./
COPY apps/server/package*.json ./apps/server/
RUN npm ci --workspace=apps/server --include-workspace-root --no-audit --no-fund
COPY apps/server ./apps/server
RUN npm run build -w apps/server

# 只保留生产依赖（npm workspaces 会提升到根 node_modules）
ENV NODE_ENV=production
RUN npm prune --omit=dev --include-workspace-root

# ---------- Stage 3: 运行镜像 ----------
FROM node:20-alpine
LABEL org.opencontainers.image.title="ToneCore"
LABEL org.opencontainers.image.description="一体化音乐中枢 · 音源搜索 / 无损落库 / 自动刮削 / 小爱音箱接入"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.url="https://github.com/deltrivx/ToneCore"
LABEL org.opencontainers.image.source="https://github.com/deltrivx/ToneCore"

# ffmpeg 用于音频校验/转码，sqlite 库供 better-sqlite3 运行时链接
RUN apk add --no-cache tini ffmpeg tzdata sqlite-libs \
    && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
    && echo "Asia/Shanghai" > /etc/timezone \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# 版本号注入：让 /api/health 与控制台徽章显示的版本与镜像标签一致，
# 避免「镜像换版本了、界面还显示旧号」。
ARG TONECORE_VERSION=0.1.0
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

# 音源脚本目录（可挂载 /data 覆盖）
RUN mkdir -p /data/sources /music

VOLUME ["/music", "/data"]
EXPOSE 8090

# wget 来自 busybox，Alpine 基础镜像自带
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8090/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/index.js"]
