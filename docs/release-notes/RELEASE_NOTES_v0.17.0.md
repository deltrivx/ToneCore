# ToneCore v0.17.0

> 播放页重构为 QQ 音乐大屏风格；修复封面丢失与小米二次验证流程错误。

## 背景

v0.16.0 上线后实测发现两个问题：播放时底部不显示专辑封面；
小米二次验证无论填什么都提示「仍需验证，请重新获取验证码」。
另外播放页仍是旧版左右分栏，未达到预期的大屏观感。

## 缺陷 1：封面字段在服务端被丢弃

### 现象

底部播放条不显示专辑封面，歌词正常。

### 根因

链路本身是通的（`/cover/<文件名>` 返回 200，library API 确实带 `cover`），
问题出在**服务端归一化队列项时把字段丢了**：

```
前端 Home.vue 送  →  cover: s.cover      （本地封面文件名）
QueueItem 类型    →  只有 coverUrl        ← 本地封面没有容身之处
normalizeQueueItem → 只读 coverUrl        ← cover 被丢弃
```

前端 `coverUrl` 计算属性本来就有 `if (c.cover) return /cover/${c.cover}` 分支，
只要服务端传下来就能显示 —— 缺的就是这一环。

### 修复

- `QueueItem` 增加 `cover?: string`（与 `coverUrl` 是两种形态：文件名 vs 完整地址）；
- `normalizeQueueItem` 保留 `cover`；
- 歌单播放入口 `/api/playlists/:id/play` 一并补传。

## 缺陷 2：二次验证走错了流程

### 现象

提交任何内容都提示「仍需验证，请重新获取验证码」。

### 根因

**小米 micoapi 的二次验证不是「输入短信验证码」。** 真实流程是：

1. 打开 `notificationUrl`
2. 在小米页面里完成短信 / 邮箱验证
3. 完成后的页面地址里产出 **ticket**
4. 用 ticket 调 `/identity/auth/verifyPhone`（或 `verifyEmail`）换取登录态

旧实现把用户在输入框里填的东西当成短信验证码 POST 给 `serviceLoginAuth2`，
服务端稳定回 81003 —— **与用户输入是否正确完全无关**，
所以「验证码明明没问题」却一直失败。

### 修复

对齐 Home Assistant（`xiaomi_miot/core/xiaomi_cloud.py`）：

1. `identity/list` 取 `identity_session` 与可用验证方式（4=手机 / 8=邮箱）
2. `verifyPhone` / `verifyEmail` 提交 ticket
3. 跟随返回的 `location` 换 `serviceToken`（**由 Set-Cookie 下发，不在响应体里**）
4. 带 cookie 重跑第一步补齐 `ssecurity`（它只在第一步返回）

新增 `submitVerifyTicket()` 与 `/api/speaker/verify-ticket`；
界面改为 ticket 输入框，支持直接粘整条验证后的地址（自动抽取 ticket）。

## 变更：播放页重构

改为 QQ 音乐大屏风格：

- 封面模糊放大铺满整屏做沉浸背景，叠暗色渐变保证文字对比度
- 居中大碟，播放时缓慢旋转（24s/圈），暂停即停
- 右侧歌词，当前行高亮放大
- 底部整幅控制区：进度 / 主控制 / 音量，播放键恒定居中
- 移动端自动上下堆叠，主控制区保持单手可及
- 尊重 `prefers-reduced-motion`，该设置下不旋转

## 验证

```
npm run build        ✅ web + server 均通过
npm test             ✅ 15 项全过
封面链路实测         ✅ /cover/<文件名> 200，library API 带 cover 字段
```

## 升级说明

重建容器即可，`/data` 数据不受影响。

- 无数据库结构变更；
- 二次验证的操作方式变了：现在需要在小米验证页完成后**回填 ticket**
  （可粘贴整条验证后的页面地址）；
- 本次改动不影响任何既有接口行为。
