# ToneCore v0.11.7

## 修复

- **`latest` 标签在 tag 构建时缺失，导致拉 latest 拿到 `version=main` 的镜像**：`type=ref,event=branch` 在 **tag 事件下同样会生成 `main` 标签**，而 `type=raw,value=latest` 只对默认分支生效——于是 tag 构建时 `latest` 未被更新，Unraid 拉 `latest` 得到的是版本号为 `main` 的镜像。迷惑点：同一 commit 的 `0.11.6` 标签版本号是对的，**两个标签的 `image.version` 不一致**，只看版本标签会误判 CI 没问题。修：`type=ref,event=branch` 加 `enable={{is_default_branch}}`，只对分支推送生效。

---

**完整变更记录**：[CHANGELOG](https://github.com/deltrivx/ToneCore/blob/main/CHANGELOG.md)
