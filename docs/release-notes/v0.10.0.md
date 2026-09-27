# ToneCore v0.10.0

## 新增

- **账号认证**：默认 `admin` / `password`，可用容器环境变量 `TONECORE_ADMIN_USER`、`TONECORE_ADMIN_PASSWORD` 覆盖（首次启动写入数据库，之后以数据库为准）。密码以 scrypt 加盐哈希存储；令牌为自签 HMAC-SHA256 JWT（access 7 天 / refresh 30 天）。新增登录页，前端请求自动携带 `Authorization: Bearer`，令牌失效自动退回登录页。
- **SQLite 持久化**：新增 `users`、`auth_tokens`、`play_history` 三张表（复用既有 `tonecore.db`）。
- **SongLoft 兼容层 `/api/v1/*`**（协议依据：实测 SongLoft v2.12.1）：认证 `login/refresh/logout/me`、基础 `health/version`、曲库 `songs/songs/search/songs/stats/stats`、歌单 `playlists`、播放 `player/player/play/player/control`、历史 `play-history`、取流 `stream`、`songs/:id/cover`。响应与错误体与 SongLoft 同构（错误为 `{ detail, error }`）。

## 变更

- 容器模板新增「管理员账号 / 管理员密码 / 令牌签名密钥」三个变量，`docker-compose.yml` 同步支持。

---

**完整变更记录**：[CHANGELOG](https://github.com/deltrivx/ToneCore/blob/main/CHANGELOG.md)
