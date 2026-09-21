# ---------- Stage 1: 构建前端 ----------
FROM node:20-alpine AS web-builder
WORKDIR /app
COPY package*.json ./
COPY apps/web/package*.json ./apps/web/
RUN npm ci --workspace=apps/web --include-workspace-root
COPY apps/web ./apps/web
RUN npm run build -w apps/web

# ---------- Stage 2: 构建后端 ----------
FROM node:20-alpine AS server-builder
WORKDIR /app
COPY package*.json ./
COPY apps/server/package*.json ./apps/server/
RUN npm ci --workspace=apps/server --include-workspace-root
COPY apps/server ./apps/server
RUN npm run build -w apps/server

# ---------- Stage 3: 运行镜像 ----------
FROM node:20-alpine
LABEL org.opencontainers.image.title="ToneCore"
LABEL org.opencontainers.image.description="一体化音乐中枢"
LABEL org.opencontainers.image.licenses="Apache-2.0"

RUN apk add --no-cache tini ffmpeg tzdata \
    && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
    && echo "Asia/Shanghai" > /etc/timezone

WORKDIR /app
ENV NODE_ENV=production
ENV MUSIC_DIR=/music
ENV DATA_DIR=/data
ENV PORT=8090

COPY --from=server-builder /app/apps/server/dist ./server
COPY --from=server-builder /app/apps/server/node_modules ./node_modules
COPY --from=web-builder /app/apps/web/dist ./public

VOLUME ["/music", "/data"]
EXPOSE 8090

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/index.js"]
