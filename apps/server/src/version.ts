/**
 * 版本号唯一出处。
 *
 * 所有对外暴露版本的地方（/api/health、控制台页脚、构建元数据）都必须从这里取，
 * 不允许在别处硬编码 —— 否则发版时必然漏改某一处。
 *
 * ⚠️ 发版只改这一个文件。
 *
 * 镜像构建时会用 `ARG TONECORE_VERSION` 覆盖本值（见 docker/Dockerfile），
 * 所以**不要去改 package.json / package-lock.json 的 version 字段**：
 * Dockerfile 的依赖层是 `COPY package*.json` + `npm ci`，按文件内容算缓存键，
 * 改版本号会让该层失效，导致 arm64 在 QEMU 下重装整棵依赖树
 * （实测 3 分 38 秒 → 40 分钟以上）。而那个字段对镜像毫无作用。
 *
 * 发版流程详见 docs/development.md「发版」一节。
 */
export const VERSION_DEFAULT = '0.6.2';

/** 运行期版本：构建时注入的 TONECORE_VERSION 优先 */
export const VERSION: string = process.env.TONECORE_VERSION || VERSION_DEFAULT;
