import { spawnSync } from "node:child_process";

const suites = ["tools/smoke.mjs", "tools/regression.mjs"];
let failed = 0;
for (const suite of suites) {
  const result = spawnSync(process.execPath, [suite], { stdio: "inherit", windowsHide: true });
  if (result.status !== 0) failed += 1;
}
process.exit(failed === 0 ? 0 : 1);
