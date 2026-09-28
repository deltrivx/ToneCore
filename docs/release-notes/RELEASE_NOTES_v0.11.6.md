# ToneCore v0.11.6

## 修复

- **Subsonic 取流转 502**：v0.11.4 把流重定向改成用 `encodeURIComponent(filePath)`，但该函数会把路径分隔符 `/` 编码成 `%2F`，而 Fastify 的通配路由 `/stream/*` **不匹配含 `%2F` 的路径** → 取流全部 502。（直连 `/stream/<原路径>` 返回 200，一经重定向就失败——容易误判成「流坏了」。）新增 `encodeRelPath()`：**逐段编码、保留 `/` 作为分隔符**。
- **SongLoft 兼容层同类问题**：`/api/v1/stream` 仍指向不存在的 `/api/library/<id>/stream`，且未先按 id 取出曲目。一并修正。

---

**完整变更记录**：[CHANGELOG](https://github.com/deltrivx/ToneCore/blob/main/CHANGELOG.md)
