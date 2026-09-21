/**
 * 版本号唯一出处。
 *
 * 所有对外暴露版本的地方（/api/health、控制台页脚、构建元数据）都必须从这里取，
 * 不允许在别处硬编码 —— 否则发版时必然漏改某一处。
 *
 * 发版流程详见 docs/development.md「发版」一节。
 */
export const VERSION_DEFAULT = '0.1.0';

/** 运行期版本：构建时注入的 TONECORE_VERSION 优先 */
export const VERSION: string = process.env.TONECORE_VERSION || VERSION_DEFAULT;
