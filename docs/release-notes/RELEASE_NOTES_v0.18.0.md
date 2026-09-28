# ToneCore v0.18.0

> 彻底移除小爱音箱功能；播放改为点底栏直达全屏，浮窗面板废弃。

## 背景

小米账号在二次验证阶段返回「该账号未绑定手机或邮箱」，该账号无法通过 micoapi
完成登录（HA 的实现同样依赖手机/邮箱二选一）。音箱功能因此无法闭环，按用户要求
**整体下线**，前后端全量解绑，不再保留回退开关。

同时用户反馈「点击播放控件弹出的播放浮窗设计过于简略」，改为成熟音乐平台的主流
做法：**点底部播放条直接展开全屏播放页**，去掉中间那层浮窗。

## 移除：小爱音箱（前后端）

后端：
- 删除 `apps/server/src/services/speaker/`（`index.ts` + `protocol.ts`）
- `routes/index.ts`：删除全部 `/api/speaker/*` 路由、类型依赖里的 `speaker`、
  health 里的 `speaker` / `devices` 字段、`/api/play` 里的推送分支
- `index.ts`：移除服务实例化、依赖注入、监听启停与关停回调
- `Orchestrator`：摘掉 `attachSpeaker`、`handleVoiceCommand`、`shiftQueue`、
  `rememberSession`、`sessionSnapshot` 与 `PlaySession` —— 这些结构仅为语音
  点歌存在，一并清除

前端：
- 删除 `components/SpeakerConfig.vue`
- `useApi.js`：移除全部 `speaker*` 方法
- `Settings.vue`：移除音箱卡片、登录/验证/退出/试播/控制/音量的全部逻辑与状态
- `Icon.vue`：移除仅音箱使用的 `speaker` 矢量图标

## 变更：播放入口

- 删除 `components/NowPlayingSheet.vue`
- `MiniPlayer`：点曲目区 / 队列按钮 / 移动端入口 → 统一 `player.expand()`
- `usePlayer`：移除 `sheetOpen` 与 `openSheet/closeSheet/toggleSheet`，
  改为提供 `expand()` / `collapse()`
- `App.vue`：不再挂载浮窗面板

## 验证

```
npm run build     ✅ web + server 均通过
npm test          ✅ 15 项全过
grep 残留         ✅ speaker / NowPlayingSheet / openSheet 均无残留
```

## 升级说明

重建容器即可，`/data` 数据不受影响。

- **行为变化**：设置页不再有「小爱音箱接入」区块，相关接口已全部下线；
- 无数据库结构变更，已存的音箱配置不再被读取（后续版本可清理，不影响运行）；
- 播放的展开方式变了：点底部播放条直接进入全屏播放页。
