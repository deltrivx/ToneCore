# ToneCore v0.11.4

## 修复

- **Subsonic 的 `stream` / `download` 取流 404**：这两个方法原本重定向到 `/api/library/<id>/stream`，但**该端点并不存在**——真实的流端点是 `/stream/<相对路径>`（按文件路径取，且支持 HTTP Range，客户端拖动进度依赖它）。结果所有取流请求都 404，Subsonic 客户端虽能登录、能浏览，但**一播放就失败**。现改为重定向到 `/stream/<encodeURIComponent(filePath)>`。

---

**完整变更记录**：[CHANGELOG](https://github.com/deltrivx/ToneCore/blob/main/CHANGELOG.md)
