# ToneCore v0.11.0

## 新增

- **Subsonic REST API 兼容层 `/rest/*`**。Subsonic 是自托管音乐领域的事实标准，实现它之后 **箭头音乐（amcfy-music）、Feishin、Sonixd、Substreamer** 等一大批客户端可直接连接本中枢。
  - 认证支持 `p=<明文|enc:hex>` 与 `t=md5(密码+salt) & s=<salt>` 两种。
  - 已实现 ping / getArtists / getIndexes / getAlbumList2 / getAlbum / getArtist / search3 / stream / getCoverArt / getLyricsBySongId / scrobble / getPlaylists 等 30+ 个方法。
  - 响应为 `subsonic-response` 信封；`.view` 后缀与无后缀都接受。仅输出 JSON。
- **账号自助管理**：新增昵称；支持改登录账号 / 密码 / 昵称；改密码需验证当前密码；**改登录名会同步迁移令牌、播放进度与用户设置**。
- **播放进度持久化（跨设备续播）**：新增 `play_progress` 表，播放中每 5 秒节流上报、暂停/切歌立即落库。
- **用户设置持久化**：新增 `user_settings` 表。
- 设置页新增「账号」卡片，并显示数据库路径与持久化说明。

## 变更

- **取消环境变量覆盖账号**：改为固定默认值初始化一次，之后以数据库为准，用户可在设置页自行修改。容器模板中的对应变量已移除。
- `users` 表新增 `nickname`、`pwd_enc` 列（老库自动迁移），后者用于满足 Subsonic 令牌认证。

---

**完整变更记录**：[CHANGELOG](https://github.com/deltrivx/ToneCore/blob/main/CHANGELOG.md)
