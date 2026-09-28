# ToneCore v0.11.2

## 修复

- **镜像内版本号错成 `main`**：CI 用 `docker/metadata-action` 的 `steps.meta.outputs.version` 注入 `TONECORE_VERSION`，而该输出取的是 tags 列表**第一项**；配置里 `type=ref,event=branch` 排在 `type=semver` 之前，导致 tag 构建（如 v0.11.1）产出的镜像版本号也是 `main`，`/api/health` 与界面徽章均显示错误版本。现将 `type=semver` 提到最前，并把构建参数兜底为 `steps.meta.outputs.version || github.ref_name`。

---

**完整变更记录**：[CHANGELOG](https://github.com/deltrivx/ToneCore/blob/main/CHANGELOG.md)
