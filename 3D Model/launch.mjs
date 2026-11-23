/** Reuse the sibling project's installed tooling without installing another dependency tree. */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const here = import.meta.dirname;
const root = process.env.BCIT_PROJECT || resolve(here, "..");
const require = createRequire(resolve(root, "package.json"));
const mode = process.argv[2] || "start";
if (["start", "build"].includes(mode)) {
  const { build } = require("esbuild");
  await build({
    entryPoints: [resolve(here, "viewer.ts"), resolve(here, "stairs.ts"), resolve(here, "three-view.mjs")],
    outdir: here,
    bundle: true,
    format: "esm",
    target: "es2022",
  });
}
if (mode === "build") {
  const check = spawnSync(
    process.execPath,
    [
      require.resolve("typescript/bin/tsc"),
      "--noEmit",
      "--allowImportingTsExtensions",
      "--module",
      "nodenext",
      "--target",
      "es2022",
      "--lib",
      "es2022,dom",
      "--skipLibCheck",
      "--types",
      "node",
      "--typeRoots",
      resolve(root, "node_modules/@types"),
      ...[
        "viewer.ts",
        "stairs.ts",
        "server.ts",
        "model.ts",
        "inspector.test.ts",
      ].map((p) => resolve(here, p)),
    ],
    { stdio: "inherit", cwd: here },
  );
  process.exit(check.status ?? 1);
}
const tasks = {
  start: [
    "--import",
    pathToFileURL(require.resolve("tsx")).href,
    resolve(here, "server.ts"),
  ],
  test: [
    "--import",
    pathToFileURL(require.resolve("tsx")).href,
    "--test",
    resolve(here, "inspector.test.ts"),
    resolve(here, "model-audit.test.mjs"),
    resolve(here, "stair-training.test.mjs"),
  ],
  format: [
    require.resolve("prettier/bin/prettier.cjs"),
    "--write",
    "--ignore-path",
    "no-ignore-file",
    "*.ts",
    "*.mjs",
    "*.html",
    "*.css",
    "*.json",
    "*.md",
  ],
  validate: [
    "--import",
    pathToFileURL(require.resolve("tsx")).href,
    resolve(root, "scripts/validate-data.ts"),
  ],
};
if (!tasks[mode]) throw Error("Unknown command");
const result = spawnSync(process.execPath, tasks[mode], {
  stdio: "inherit",
  cwd: here,
  env: { ...process.env, BCIT_PROJECT: root },
});
process.exit(result.status ?? 1);
