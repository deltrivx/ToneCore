# ToneCore v0.15.0

修复小米账号登录返回 code=10001「系统错误」：登录上下文端点已失效。

### 修复

- **登录上下文端点失效（致命）**：第一步取 `_sign` 走的是
  `/fe/service/identity/authStart`，该端点现已改为直接返回 **React 登录页 HTML**
  （约 22KB，不再是 JSON），解析不出 `_sign`，于是第二步 `serviceLoginAuth2`
  必然返回 code=10001「系统错误」——与账号密码是否正确完全无关。
  改为 `/pass/serviceLogin?sid=micoapi&_json=true`，实测仍返回 JSON 且带 28 位 `_sign`。
- 顺带改用服务端回传的 `qs` / `serviceParam` / `callback`，不再本地硬编码，
  避免服务端参数调整后再次静默失效。
- `_sign` 取不到时增加明确告警日志，便于下次快速定位。

### 排查记录

逐项排除（均实测）：
- 换 UA（MiHome 6.x / 9.x / MICO / curl / 浏览器）→ 全部返回 HTML，排除 UA 问题
- 换 authStart 的其它路径与参数组合 → 全部返回 HTML，排除参数问题
- 换 `/pass/serviceLogin?sid=micoapi&_json=true` → **返回 JSON 且带 _sign** ✅

注意：不带 `_json=true` 时 `/pass/serviceLogin` 同样返回 HTML，
`_json=true` 是拿到 JSON 响应的必要条件。

---

**完整变更记录**：[CHANGELOG](https://github.com/deltrivx/ToneCore/blob/main/CHANGELOG.md)
