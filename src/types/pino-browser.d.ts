// pino ships types only for its main entry ("pino"); the "pino/browser"
// subpath has no bundled declaration, so declare it here.
declare module "pino/browser" {
  import type { Logger, LoggerOptions } from "pino";

  interface PinoBrowserOptions {
    /** Log the raw object instead of a formatted string. */
    asObject?: boolean;
    /** Custom sink; default is console[level]. */
    write?: (o: Record<string, unknown>) => void;
  }

  function pino(options?: LoggerOptions & { browser?: PinoBrowserOptions }): Logger;
  export default pino;
}
