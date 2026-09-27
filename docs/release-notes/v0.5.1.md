# ToneCore v0.5.1

## 修复

- **歌单删除 / 移除曲目 400**：前端对无 body 的请求仍带 `Content-Type: application/json`，Fastify 默认对「声明了 JSON 但体为空」的请求抛 `400 FST_ERR_CTP_EMPTY_JSON_BODY`，导致「删除歌单」「从歌单移除曲目」在界面上失败。
  - 前端：仅在确有 body 时声明 `Content-Type: application/json`。
  - 服务端：注册宽容的 `application/json` 内容类型解析器，空体直接当作 `{}` 处理，任何客户端都不会再因空体 400。
- 歌单增删改查（含整张播放）现已端到端可用。

完整改动见 [v0.5.0](https://github.com/deltrivx/ToneCore/releases/tag/v0.5.0)。

---

**完整变更记录**：[CHANGELOG](https://github.com/deltrivx/ToneCore/blob/main/CHANGELOG.md)
