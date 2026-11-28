// Writes the runtime OpenAPI spec to a checked-in JSON file so the CI drift
// gate can detect an out-of-date spec without booting Next. Keep this
// deterministic: no timestamps, no environment-derived values.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { OPENAPI_SPEC } from "../../src/lib/openapi/spec";

const out = resolve(process.cwd(), "docs/api/openapi.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(OPENAPI_SPEC, null, 2)}\n`);
console.log(`[openapi] wrote ${out}`);
