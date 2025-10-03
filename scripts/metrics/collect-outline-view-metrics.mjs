/* eslint-env node */
import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..", "..");
const outlineViewPath = resolve(repoRoot, "apps/web/src/outline/OutlineView.tsx");

const source = await readFile(outlineViewPath, "utf8");
const lines = source.split(/\r?\n/);
const sizeBytes = Buffer.byteLength(source, "utf8");

const importPattern = /import\s+(?:[\s\S]*?)from\s+["']([^"']+)["'];?|import\s+["']([^"']+)["'];/g;
const dependencySet = new Set();
let match;
while ((match = importPattern.exec(source)) !== null) {
  const specifier = match[1] ?? match[2];
  if (specifier) {
    dependencySet.add(specifier);
  }
}

const categorize = (specifier) => {
  if (specifier.startsWith(".")) {
    return "internal";
  }
  if (specifier.startsWith("@thortiq/")) {
    return "workspace";
  }
  return "thirdParty";
};

const categorized = {
  internal: [],
  workspace: [],
  thirdParty: []
};

for (const specifier of Array.from(dependencySet).sort()) {
  const bucket = categorize(specifier);
  categorized[bucket].push(specifier);
}

const summary = {
  file: "apps/web/src/outline/OutlineView.tsx",
  generatedAt: new Date().toISOString(),
  lineCount: lines.length,
  sizeBytes,
  dependencyTotals: {
    internal: categorized.internal.length,
    workspace: categorized.workspace.length,
    thirdParty: categorized.thirdParty.length,
    total: dependencySet.size
  },
  dependencies: categorized
};

const outputDir = resolve(repoRoot, "docs/metrics");
await mkdir(outputDir, { recursive: true });
const outputPath = resolve(outputDir, "OutlineView-baseline.json");
await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

process.stdout.write(`OutlineView metrics written to ${outputPath}\n`);
