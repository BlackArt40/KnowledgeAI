export type { ExternalResult, SourceConfig, SourceType } from "./types";
export { deduplicateResults, normalizeUrl, qualityScore } from "./types";
export {
  getSourceConfig, isExternalEnabled, externalLabel,
  searchExternal, crawlUrl, deepCrawl,
} from "./provider";
