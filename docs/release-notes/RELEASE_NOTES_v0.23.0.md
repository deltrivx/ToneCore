# ToneCore v0.23.0

> 修在线/锁屏专辑图；曲库页取消歌单；新增在线音乐推荐。

## 修复一：在线搜索结果没有专辑图

### 现象

在线搜索出来的歌，列表里**全都没有专辑图**（只有占位图标）。

### 根因

`normalizeSearchResult()` 里封面只读一个字段：

```ts
coverUrl: it?.img ? String(it.img) : undefined,
```

但各家洛雪脚本的封面字段名**并不统一** —— 实测抓到的真实情况：

| 脚本 | 封面字段 |
|---|---|
| 全豆要[聚合音源].js | `pic` |
| 星海音乐源.js | `cover` |
| （标准洛雪字段） | `img` |

字段名对不上，于是 `coverUrl` **永远是 None**。
实测验证：`kw` / `wy` 各 20 条结果，**0 条**带封面。

### 修法

新增 `pickCover()`，按优先级取第一个非空值：

```
img → picUrl → pic → cover → albumImg → image
```

## 修复二：锁屏没有专辑图

### 现象

上一版加了 Media Session，但锁屏上**专辑图仍然不显示**。

### 根因

artwork 的 `type` 被写死成 `image/png`：

```js
type: 'image/png',      // ← 一律 png
```

而曲库里的封面绝大多数是 `.jpg` —— 实测 12 首：
**11 个 jpg、1 个 png**。系统媒体控件会拒掉 MIME 不匹配的艺术图。

### 修法

按真实扩展名给 type（png / webp / jpeg 兜底）。

> 顺带说明：`/cover/<name>` 路由本身**不需要鉴权**（实测无 token 也 200），
> 所以锁屏取图这条路是通的 —— 问题纯粹出在 MIME。

## 变更：曲库页取消歌单

按用户要求移除。曲库页从此专注「我的音乐」：检索 + 曲目列表。

清理范围（模板 + 脚本）：
- 歌单区块（含新建按钮）
- 「加入歌单」选择浮层
- 歌单详情浮层
- 脚本里的死代码：`playlists` / `pickSong` / `activePlaylist` /
  `activeTracks` 及 `createPlaylist` / `delPlaylist` / `openPlaylist` /
  `playPlaylist` / `playTrackAt` / `removeTrack` / `openPick` /
  `addToPlaylist` / `createAndAdd` / `loadPlaylists`

后端 `/api/playlists` 等接口保留（首页仍在用），只移除曲库页的入口。

## 新增：在线音乐推荐

### 为什么需要

首页原有的推荐都是**本地**维度：最近入库 / 专辑 / 歌手。
曲库小的时候（实测 12 首），这几个维度很快就没什么可推荐的，
首页看着是空的 —— 不像一个音乐应用。

### 做法

新增 `/api/recommend`，取网易云**公开**榜单接口（无需鉴权，实测可达）：

- `/api/toplist` —— 榜单清单
- `/api/playlist/detail?id=xxx` —— 榜单内曲目（**自带封面**）

选用四个榜：热歌榜 / 新歌榜 / 原创歌曲榜 / 飙升榜。

两个设计取舍：

1. **只展示引导，不落库**：点某首走正常的在线播放链路
   （与在线搜索一致），不在这里写盘。
2. **失败返回空数组而非抛错**：在线推荐只是锦上添花，
   网络不通不该让首页整体加载失败。

## 验证

```
npm run build     ✅ web + server 均通过
npm test          ✅ 15 项全过
```

## 待办

- 音源状态显示口径（用户反馈仍有问题）
- 歌词：不同歌曲的前奏长度不同，仍需按曲目校准（校准值已按曲目记忆）
