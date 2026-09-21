import pino from 'pino';

/**
 * 日志级别：LOG_LEVEL 环境变量优先（容器模板里暴露），否则 info。
 *
 * 这里直接读 process.env 而不经过 loadConfig()，是为了避免
 * 「logger 依赖 config、config 出问题时连日志都看不到」的循环依赖。
 * 两者读同一个环境变量名，口径不会漂移。
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'production'
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } },
});
