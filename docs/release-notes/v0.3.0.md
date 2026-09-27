# ToneCore v0.3.0

## 修复

- **音源取链全部 30s 超时（致命）**：宿主派发任务后只等脚本回叫 `lx.send('request', {requestKey, data})`，但洛雪主流脚本的 `request` 处理器是同步返回 Promise（`return handleGetMusicUrl(...)`），根本不回叫。于是每一路取链都必然等满 30s 超时，表现为「所有音源都取不到直链」。改为同时接受两条回填路径——处理器返回的 Promise（主流）与脚本显式 send（少数/旧实现）——谁先到用谁，另一个自动作废。修复后 Free listen、HYWmusic、全豆要、念心 等音源恢复秒级取链。
- **取链链路健壮性**：`invoke` 返回值做了统一的幂等结算（只 resolve/reject 一次），避免「Promise 与 send 双路回填」导致某路永远悬挂；超时计时器在结算时一并清除。

---

**完整变更记录**：[CHANGELOG](https://github.com/deltrivx/ToneCore/blob/main/CHANGELOG.md)
