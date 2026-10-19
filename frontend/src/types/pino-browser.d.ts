// V6：pino/browser 子路径的类型声明——log-browser（@shared/obs）在 frontend
// 独立 tsconfig 下解析不到 Next 侧依赖图的类型（Next 侧 node_modules 提供）。
// log-browser 以工厂形式调用并使用 warn 级别，声明为宽松形态即可。
declare module "pino/browser" {
  interface BrowserLogger {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  }
  function pino(opts?: unknown): BrowserLogger;
  export default pino;
}
