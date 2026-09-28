# ToneCore v0.24.0

> 修在线搜索专辑图（网易只返回 picId，需再取 song/detail 补图）。

## 修复：在线搜索结果依然没有专辑图

### 背景：先承认上一版改错了地方

v0.23.0 声称修好了在线封面，实际**没有生效**。原因是改到了死代码上：

```
$ grep -rn "normalizeSearchResult" apps/server/src/
apps/server/src/services/source/loader.ts:355:export function normalizeSearchResult(...)  ← 只有定义，零调用方
```

它本是为「洛雪音源脚本返回」准备的归一化函数，但宿主搜索早已自研
（`services/search/index.ts` 注释里写明了：洛雪脚本只提供取直链，
搜索必须由宿主实现），所以这条路径根本不会被走到。

教训：**先确认调用链再改**，不要只看字段对不对。

### 真正根因（实测）

真实路径是 `apps/server/src/services/search/platforms/wy.ts`。它读的是：

```ts
coverUrl: x.album?.picUrl ? String(x.album.picUrl) : undefined,
```

而实测网易云搜索接口 `/api/search/get/web` 返回的 album 结构里
**根本没有 `picUrl`，只有 `picId`**：

```
album keys: ['artist', 'copyrightId', 'id', 'mark', 'name', 'picId',
             'publishTime', 'size', 'status']
```

所以 `coverUrl` 恒为 `undefined` —— 在线搜索结果永远没有封面。

### 修法

新增 `fillWyCovers()`：搜索出结果后，批量调一次
`/api/song/detail?ids=[id1,id2,...]` 拿真实 `picUrl` 回填。

设计要点：

1. **一次批量请求**拿全部，不逐首请求（否则搜索会被拖慢几十倍）；
2. **同时回填 `raw.img`** —— 洛雪音源脚本是按这个字段取封面的，
   只补 `coverUrl` 的话，入库时仍然没图；
3. **失败静默** —— 封面只是锦上添花，`song/detail` 拿不到
   不该让搜索整体失败。

实测验证：`/api/song/detail` 能正常返回 `album.picUrl`。

### 顺带说明

酷我（`kw.ts`）**从不设置 `coverUrl`**（grep 结果为空），
且实测酷我搜索的 `abslist` 里也没有现成封面地址
（`img1.kuwo.cn/star/albumcover/...` 直连 404）。
酷我封面需要另找途径（可按 albumid 拼装或走详情页），
本版未处理 —— 列为待办。

## 验证

```
npm run build     ✅ web + server 均通过
npm test          ✅ 15 项全过
```

## 待办

- 酷我（kw）在线搜索封面：该平台目前从不返回封面地址
- 音源状态显示口径（用户反馈仍有问题）
- 歌词按曲目校准（偏移已按曲目记忆，仍需人工听校）
