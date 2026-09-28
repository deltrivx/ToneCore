# ToneCore Releases

[项目说明](README.md) | [更新日志](CHANGELOG.md)

本页是 **ToneCore 的版本索引**。GitHub Releases 侧栏按发布时间排序，本页按语义化版本号排序，
避免后补的旧版本让版本顺序看起来错乱。

**当前稳定版：** [v0.26.0](https://github.com/deltrivx/tonecore/releases/tag/v0.26.0)

> 本文件由 `scripts/gen_releases.py` 从 `CHANGELOG.md` 生成，修改请改 CHANGELOG 后重新生成。

## 版本索引

| Version | 日期 | 更新摘要 | 发布说明 |
|---|---|---|---|
| [v0.26.0](https://github.com/deltrivx/tonecore/releases/tag/v0.26.0) | 2026-09-28 | 主页专管本地歌曲、曲库专管推荐与下载；取消主页专辑/歌手分类 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.26.0.md) |
| [v0.25.0](https://github.com/deltrivx/tonecore/releases/tag/v0.25.0) | 2026-09-28 | 修锁屏媒体控件（作用域错误致 metadata 从未上报）；修移动端歌词显示区域；推荐移入曲库；取消主页最近入库 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.25.0.md) |
| [v0.24.0](https://github.com/deltrivx/tonecore/releases/tag/v0.24.0) | 2026-09-28 | 修在线搜索专辑图（网易只返回 picId，需再取 song/detail 补图） | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.24.0.md) |
| [v0.23.0](https://github.com/deltrivx/tonecore/releases/tag/v0.23.0) | 2026-09-28 | 修在线/锁屏专辑图；曲库页取消歌单；新增在线音乐推荐 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.23.0.md) |
| [v0.22.0](https://github.com/deltrivx/tonecore/releases/tag/v0.22.0) | 2026-09-28 | 新增系统媒体控件（锁屏显示歌名/歌手/专辑图）；滑动切歌收窄到专辑图；歌词加一键对齐 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.22.0.md) |
| [v0.21.0](https://github.com/deltrivx/tonecore/releases/tag/v0.21.0) | 2026-09-28 | 统一音源状态口径；歌词支持偏移校准并解析 [offset:]；左右滑切歌加跟手动画 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.21.0.md) |
| [v0.20.0](https://github.com/deltrivx/tonecore/releases/tag/v0.20.0) | 2026-09-28 | 修复音源健康度死锁与歌词错配；全屏页支持左右滑切歌；新增入库下载进度面板 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.20.0.md) |
| [v0.19.0](https://github.com/deltrivx/tonecore/releases/tag/v0.19.0) | 2026-09-28 | 图标重做为圆形灰底；首页加歌单与推荐；音源状态默认显示；入库可选音质；修复续播不还原进度 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.19.0.md) |
| [v0.18.0](https://github.com/deltrivx/tonecore/releases/tag/v0.18.0) | 2026-09-28 | 彻底移除小爱音箱功能；播放改为点底栏直达全屏，浮窗面板废弃 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.18.0.md) |
| [v0.17.0](https://github.com/deltrivx/tonecore/releases/tag/v0.17.0) | 2026-09-28 | 播放页重构为 QQ 音乐大屏风格；修复封面丢失与小米二次验证流程错误 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.17.0.md) |
| [v0.16.0](https://github.com/deltrivx/tonecore/releases/tag/v0.16.0) | 2026-09-28 | 修复验证码校验报「登录验证失败」，以及刷新后续播卡在缓冲中。 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.16.0.md) |
| [v0.15.0](https://github.com/deltrivx/tonecore/releases/tag/v0.15.0) | 2026-09-28 | 修复小米账号登录返回 code=10001「系统错误」：登录上下文端点已失效。 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.15.0.md) |
| [v0.14.0](https://github.com/deltrivx/tonecore/releases/tag/v0.14.0) | 2026-09-28 | 移除界面无用文案，修复音箱「设备为 0」的真实根因，并改为自主认证。 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.14.0.md) |
| [v0.13.0](https://github.com/deltrivx/tonecore/releases/tag/v0.13.0) | 2026-09-28 | 设置页结构调整，并完整复刻 SongLoft MIoT 插件的音箱配置能力（前后端）。 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.13.0.md) |
| [v0.12.0](https://github.com/deltrivx/tonecore/releases/tag/v0.12.0) | 2026-09-28 | 从科技风 demo 界面重构为成熟音乐平台的界面体系：图标矢量统一、导航收口、设计 token 落地 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.12.0.md) |
| [v0.11.7](https://github.com/deltrivx/tonecore/releases/tag/v0.11.7) | 2026-09-23 | 修复 tag 构建时 latest 标签缺失导致拉到 version=main 的镜像 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.11.7.md) |
| [v0.11.6](https://github.com/deltrivx/tonecore/releases/tag/v0.11.6) | 2026-09-23 | - **Subsonic 取流转 502**：v0.11.4 把流重定向改成用 `encodeURIComponent(filePath)`，但该函数会把路径分隔符 `/` 编码成 `%2F`，而 Fastify 的通配路由 `/st… | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.11.6.md) |
| [v0.11.5](https://github.com/deltrivx/tonecore/releases/tag/v0.11.5) | 2026-09-23 | - **前端整体白屏（全黑无内容）**：上一版把播放进度上报函数写在 `ensureAudio()` 内部，它们只被 `<audio>` 事件回调引用，**rollup 判定为未使用代码，连同调用点一起删除**；但 `usePlaye… | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.11.5.md) |
| [v0.11.4](https://github.com/deltrivx/tonecore/releases/tag/v0.11.4) | 2026-09-23 | - **Subsonic 的 `stream` / `download` 取流 404**：这两个方法原本重定向到 `/api/library/<id>/stream`，但**该端点并不存在**——真实的流端点是 `/stream/<… | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.11.4.md) |
| [v0.11.3](https://github.com/deltrivx/tonecore/releases/tag/v0.11.3) | 2026-09-23 | - 补上一次遗漏：`.github/workflows/docker.yml` 的修改**实际未提交进仓库**（提交清单漏了该文件），因此 v0.11.2 的镜像版本号仍为 `main`。本次真正提交。修正后 tag 构建的镜像会带上… | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.11.3.md) |
| [v0.11.2](https://github.com/deltrivx/tonecore/releases/tag/v0.11.2) | 2026-09-23 | - **镜像内版本号错成 `main`**：CI 用 `docker/metadata-action` 的 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.11.2.md) |
| [v0.11.1](https://github.com/deltrivx/tonecore/releases/tag/v0.11.1) | 2026-09-23 | - **升级前创建的账号无法使用 Subsonic 令牌认证**：`users.pwd_enc`（Subsonic 令牌认证 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.11.1.md) |
| [v0.11.0](https://github.com/deltrivx/tonecore/releases/tag/v0.11.0) | 2026-09-23 | 新增 **Subsonic REST API 兼容层**（第三方 App 可直接连接）、账号自助管理、播放进度持久化。 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.11.0.md) |
| [v0.10.0](https://github.com/deltrivx/tonecore/releases/tag/v0.10.0) | 2026-09-23 | 新增账号认证与 SongLoft 兼容层（第一阶段）：外部设备可按 SongLoft 方式连接本中枢。 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.10.0.md) |
| [v0.9.0](https://github.com/deltrivx/tonecore/releases/tag/v0.9.0) | 2026-09-23 | 修复音源停用后卡片消失的 bug；播放条常驻并显示封面与歌词；播放面板按成熟音乐平台重做；小爱配置补全。 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.9.0.md) |
| [v0.8.1](https://github.com/deltrivx/tonecore/releases/tag/v0.8.1) | 2026-09-22 | 修复「按专辑」检索取不到曲目。 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.8.1.md) |
| [v0.8.0](https://github.com/deltrivx/tonecore/releases/tag/v0.8.0) | 2026-09-22 | 云端搜索支持按「歌曲 / 歌手 / 专辑」检索与直接入库；主页支持多种显示方式；界面去噪。 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.8.0.md) |
| [v0.7.1](https://github.com/deltrivx/tonecore/releases/tag/v0.7.1) | 2026-09-22 | 修复音源「测试」按钮恒定失败，并去掉主页重复展示、理清两个搜索框的语义。 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.7.1.md) |
| [v0.7.0](https://github.com/deltrivx/tonecore/releases/tag/v0.7.0) | 2026-09-22 | 播放界面改为「底部常驻播放条 + 上浮面板」，主页回归本地歌曲，歌单归曲库，设置页重排并补「关于」。 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.7.0.md) |
| [v0.6.2](https://github.com/deltrivx/tonecore/releases/tag/v0.6.2) | 2026-09-22 | 修复「音源测试」对一批脚本的假阴性误报。 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.6.2.md) |
| [v0.6.1](https://github.com/deltrivx/tonecore/releases/tag/v0.6.1) | 2026-09-22 | 修复音源运行时把新版脚本误判为加载失败，解锁一批可用音源。 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.6.1.md) |
| [v0.6.0](https://github.com/deltrivx/tonecore/releases/tag/v0.6.0) | 2026-09-22 | 主页按 Navidrome 的视觉语言重做，并修掉「删了文件却仍残留曲目」与音源健康度被永久锁死两个问题。 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.6.0.md) |
| [v0.5.1](https://github.com/deltrivx/tonecore/releases/tag/v0.5.1) | 2026-09-22 | 修复 v0.5.0 引入的歌单删除 / 移除曲目失败。 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.5.1.md) |
| [v0.5.0](https://github.com/deltrivx/tonecore/releases/tag/v0.5.0) | 2026-09-22 | 参照 Navidrome / SongLoft 主流结构重做页面：导航收敛为「主页 / 曲库 / 音源 / 设置」四项， | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.5.0.md) |
| [v0.4.0](https://github.com/deltrivx/tonecore/releases/tag/v0.4.0) | 2026-09-22 | 把「正在播放」整合进音乐库，听歌不必在两个页面之间来回跳；搜索入口收敛为一个。 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.4.0.md) |
| [v0.3.0](https://github.com/deltrivx/tonecore/releases/tag/v0.3.0) | 2026-09-22 | 修复音源取链「全军覆没」级别的根因缺陷，并顺带收紧取链链路的健壮性。 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.3.0.md) |
| [v0.2.0](https://github.com/deltrivx/tonecore/releases/tag/v0.2.0) | 2026-09-21 | 从「无头中枢」升级为**自带完整播放器**：控制台改为侧边栏导航，新增本地播放与 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.2.0.md) |
| [v0.1.0](https://github.com/deltrivx/tonecore/releases/tag/v0.1.0) | 2026-09-21 | 首个版本。ToneCore 是一个**无头音乐中枢** —— 不做播放器界面，只负责把「想听的歌」 | [详细说明](./docs/release-notes/RELEASE_NOTES_v0.1.0.md) |

## 镜像标签

镜像由 GitHub Actions **云端构建**并推送至 GHCR（不在本地构建上传）：

```bash
docker pull ghcr.io/deltrivx/tonecore:latest   # 最新稳定版
docker pull ghcr.io/deltrivx/tonecore:0.26.0    # 锁定版本
```
