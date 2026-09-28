# ToneCore v0.6.1

## 修复

- **脚本 init 等待窗口过短（500ms），新版音源被误判加载失败**：新版 LX 自定义源（聚合 / 野草 / 野花 / 四音 等）普遍是「先联网拉配置、再 `send('inited')` 握手」的流程，init 往返常需 1~3 秒。原实现固定只等 500ms 就判定结果，这批脚本因此全被误判成「未返回可用实例（可能缺少 module.exports）」—— 实际上它们根本不走 `module.exports`（用的是 `globalThis.lx` + `send('inited')`），只是没赶上窗口。
  - 改为**事件驱动**：一收到 `inited` 立即收尾，最多等 12 秒。
  - 失败措辞同步修正为「未上报 inited：联网初始化超时，或脚本格式与本运行时不兼容」，不再误导为 module.exports 问题。
  - 实测「聚合音源」由此从加载失败变为 **854ms 加载成功**（平台 kg/kw/mg/tx/wy）。

完整说明见 [CHANGELOG](https://github.com/deltrivx/ToneCore/blob/main/CHANGELOG.md)。

---

**完整变更记录**：[CHANGELOG](https://github.com/deltrivx/ToneCore/blob/main/CHANGELOG.md)
