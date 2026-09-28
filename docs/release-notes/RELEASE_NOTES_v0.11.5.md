# ToneCore v0.11.5

## 修复

- **前端整体白屏（全黑无内容）**：上一版把播放进度上报函数写在 `ensureAudio()` 内部，它们只被 `<audio>` 事件回调引用，**rollup 判定为未使用代码，连同调用点一起删除**；但 `usePlayer()` 的 `return` 仍引用 `saveProgressNow` → 运行时抛 `ReferenceError: saveProgressNow is not defined`，**整个 SPA 崩溃**。表现极具迷惑性：HTTP 200、`text/html`、HTML 正常返回，但页面全黑。现把进度函数**提升到模块顶层**（与 `syncLyricIndex` 同级），被 `export` 与 `return` 双重引用，不会再被摇掉。

---

**完整变更记录**：[CHANGELOG](https://github.com/deltrivx/ToneCore/blob/main/CHANGELOG.md)
