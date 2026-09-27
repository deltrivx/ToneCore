# ToneCore v0.6.2

## 修复

- **音源测试硬取 `platforms[0]` 导致假阴性误报**：多数脚本把 `kg` 排在第一位，而宿主搜索的 kg（酷狗 SSL 证书校验失败）与 mg（咪咕改版返回 HTML）已下线，于是这些脚本在「测试」时一律报「kg 平台搜索无结果」—— 但它们在 kw / tx / wy 上其实是好的，界面上的测试按钮因此长期误报。改为**自动挑选第一个宿主仍能搜的平台**（并支持显式传 `platform` 覆盖）。

---

**完整变更记录**：[CHANGELOG](https://github.com/deltrivx/ToneCore/blob/main/CHANGELOG.md)
