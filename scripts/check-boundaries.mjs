import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const forbidden = ["react", "fastify", "sqlite", "@dispatcher/persistence", "@dispatcher/adapters"];
const targets = ["packages/domain", "packages/protocol"];
const violations = [];

for (const target of targets) {
  const packageJson = JSON.parse(readFileSync(resolve(target, "package.json"), "utf8"));
  const dependencies = Object.keys(packageJson.dependencies ?? {});
  for (const dependency of dependencies) {
    if (forbidden.some((entry) => dependency.includes(entry))) violations.push(`${target} depends on ${dependency}`);
  }
  const source = readFileSync(resolve(target, "src/index.ts"), "utf8");
  for (const dependency of forbidden) {
    if (source.includes(`from "${dependency}`) || source.includes(`from '${dependency}`)) {
      violations.push(`${target} imports ${dependency}`);
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Architecture boundaries verified");
}
