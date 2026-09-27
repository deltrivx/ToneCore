# ToneCore v0.8.1

## 修复

- **酷我专辑维度返回空**：`ft=album` 返回的是 `albumlist`（**专辑实体**），而解析逻辑复用了歌曲的 `abslist`，因此永远取空。改为先取专辑 id，再用 `stype=albuminfo` 拉该专辑曲目（曲目在 `musiclist` 字段，不是 `abslist`）。实测「叶惠美」→ 正确取到 11 首（以父之名 / 懦夫 / 晴天…）。

---

**完整变更记录**：[CHANGELOG](https://github.com/deltrivx/ToneCore/blob/main/CHANGELOG.md)
