# ToneCore v0.25.0

> 修锁屏媒体控件（作用域错误致 metadata 从未上报）；修移动端歌词显示区域；推荐移入曲库；取消主页最近入库。

## 修复一：锁屏媒体控件从未生效（真因）

### 现象

加了 Media Session 之后，锁屏/通知栏**依然只显示软件名**「ToneCore 音乐中枢」，
没有专辑图、没有歌名歌手、也没有播放控制。

### 上一版误判

v0.23.0 我判断是 artwork 的 MIME 类型问题（一律写 `image/png`，而曲库多是 jpg）。
那个问题**真实存在且已修**，但**不是主因** —— 修完锁屏依然没变。

### 真因（本次定位）

`media` 被声明在 `usePlayer()` 内部：

```js
export function usePlayer() {
  ...
  const media = useMediaSession({...});   // ← 函数作用域
}
```

而 `applyState()` 是**模块级**函数，它末尾调用：

```js
function applyState(r) {          // ← 模块级
  ...
  media.update();                 // ← 引用不到内部的 const
}
```

JS 里这会抛 `ReferenceError: media is not defined`。
而 `applyState()` 是**每一次**播放状态更新的必经之路 ——
于是 metadata **一次都没有成功上报**，锁屏只能拿 `<title>` 兜底。

### 修法

把句柄提到模块级，调用处用可选链兜住未初始化：

```js
let media = null;                                  // 模块级
function applyState(r) { ... media?.update(); }    // 安全
export function usePlayer() { ... media = useMediaSession({...}); }
```

教训：**跨作用域调用必须在真实运行时验证，不能只看编译通过**。
构建成功不代表运行时引用合法。

## 修复二：移动端歌词显示的是后面的歌词

### 用户点破了方向

我一直按「歌词不同步」在查（调 offset、加一键对齐），
用户指出：**不是同步问题，是显示区域不足**。确认后确实如此，且有两个叠加成因。

### 成因 1：滚动定位算错了基准

```js
const target = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
```

`offsetTop` 相对**最近的 positioned 祖先**计算，
而 `lyricBox` 自身没有 `position: relative` ——
于是它相对更外层祖先算，把**上方大碟的高度也算了进去**。

移动端大碟在正上方（约 300px ≈ 9 行歌词），所以滚动严重过头；
桌面端是左右布局，横向不叠加，误差只有几十 px ——
这解释了为什么「只有移动端错」。

改用 rect 差值，只关心「目标行中心」与「可视区中心」的差，与定位上下文无关：

```js
const boxRect = box.getBoundingClientRect();
const elRect  = el.getBoundingClientRect();
const delta = (elRect.top + elRect.height / 2) - (boxRect.top + boxRect.height / 2);
box.scrollTo({ top: Math.max(0, box.scrollTop + delta), behavior: 'smooth' });
```

### 成因 2：移动端歌词区本身被挤没了

竖向预算（iPhone 14，视口 844px）：

| 区块 | 高度 |
|---|---|
| 顶栏 | 58px |
| 底部控制区 | ≈150px |
| 大碟（`min(42vh,300px)`，`shrink-0`） | **300px** |
| 曲目信息 | ≈70px |
| **歌词区剩余** | **≈266px（≈6.7 行）** |

大碟带 `shrink-0`，flex 压缩不了它，只能压歌词区。
把移动端大碟缩到 `min(30vh,200px)` 后，歌词区 ≈366px（**≈9.2 行**）。
桌面端保持 `min(46vh,340px)` 不变。

## 变更：在线推荐移入曲库页

按用户要求，从主页搬到曲库页（曲目列表之上）。

同时**取消首页「最近入库」** —— 它与本地曲库列表完全重复，
首页一份、曲库页一份，等于把同样的歌摆两遍。
清理了主页脚本里的 `recent` / `playHomeSong` / 推荐相关死引用。

## 验证

```
npm run build     ✅ web + server 均通过
npm test          ✅ 15 项全过
```

## 待办

- 锁屏需真机验证：Media Session 需**先播起来**才激活，且要求**安全上下文**
  （HTTPS 或 localhost）。当前访问若是 `http://192.168.31.x:8090`，
  浏览器会直接禁用 Media Session —— 需确认访问方式。
- 酷我（kw）在线搜索封面：该平台不返回封面地址
- 音源状态显示口径
