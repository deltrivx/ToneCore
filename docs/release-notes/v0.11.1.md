# ToneCore v0.11.1

## 修复

- **升级前创建的账号无法使用 Subsonic 令牌认证**：`users.pwd_enc`（Subsonic 令牌认证所需的密码副本）是 0.11.0 才新增的列，老账号该列为空，导致 `t=md5(密码+salt)` 恒返回 401（code=40），**只有明文 `p=` 能认证**——而现代客户端默认走令牌方式，等于连不上。现在会在服务端拿到明文密码的两处（密码校验成功后、以及 Web 登录时）**自动回填** `pwd_enc`，用户无需重新设置密码。

---

**完整变更记录**：[CHANGELOG](https://github.com/deltrivx/ToneCore/blob/main/CHANGELOG.md)
