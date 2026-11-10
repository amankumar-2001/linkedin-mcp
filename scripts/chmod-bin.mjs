// Make the CLI entry executable after `tsc` (npm and npx need the +x bit).
import { chmodSync, existsSync } from "node:fs";
import { URL } from "node:url";

const bin = new URL("../dist/index.js", import.meta.url);
if (existsSync(bin)) chmodSync(bin, 0o755);
