# ToneCore v0.16.0

修复验证码校验报「登录验证失败」，以及刷新后续播卡在缓冲中。

### 修复

- **验证码校验缺少关键参数（致命）**：对齐 Home Assistant 的实现
  （`xiaomi_miot/core/xiaomi_cloud.py` 的 `_login_step2`）后修正三处：
  1. **校验步骤必须带 `hash`（密码 MD5 大写）**。HA 的 step2 无条件带上它；
     我们原先只在密码登录时传、校验时不传，小米于是稳定返回 70016
     「登录验证失败」，**与验证码是否正确完全无关** —— 这正是
     「验证码没错却报登录验证失败」的成因。
  2. 必须带第一步回传的 `qs` / `serviceParam` / `callback` / `_sign`，不能硬编码。
  3. **成功时响应体里没有 `serviceToken`**。返回的是 `location`（指向
     api2.mina.mi.com/sts），serviceToken 由该请求的 **Set-Cookie** 下发；
     且 `ssecurity` 只在第一步返回，校验响应里没有，需带 cookie 重新取一次补齐。
     旧实现只在 JSON 里找 serviceToken，找不到就判失败。
     另：micoapi 需在 location 后追加 `clientSign`（base64(sha1("nonce=..&ssecurity"))），
     否则 STS 返回 401。
- **刷新后续播一直缓冲**：`toggle()` 少了 `a.src` 赋值。刷新后 `init()` 只恢复了
  `playUrl`、没给 audio 元素设 src，点播放就在空 src 上调 `play()` → 永久 waiting；
  而换一首走 `playList()` 会设 src 所以正常 —— 表现为「只有续播会卡」。

### 变更

- 新增 `finishLogin()`（第三步：跟随 location 换 serviceToken）与
  `fetchLoginContext()`，登录上下文在两步之间完整传递。
- 需要验证码时一并回传 `qs` / `serviceParam` / `callback`，前端原样带回。

---

**完整变更记录**：[CHANGELOG](https://github.com/deltrivx/ToneCore/blob/main/CHANGELOG.md)
