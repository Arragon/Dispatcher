#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
// Stable CLI entry; each test supplies its isolated process-tree program via cwd.
new Function("require", readFileSync(join(process.cwd(), "exec"), "utf8"))(createRequire(import.meta.url));
