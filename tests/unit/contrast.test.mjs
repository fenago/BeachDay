// Wraps Sable's WCAG contrast script (tests/helpers/contrast-beachday.mjs) so a token change that breaks contrast fails `npm test`.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../helpers/contrast-beachday.mjs", import.meta.url));

describe("contrast of public/css/tokens.css", () => {
  it("every text/background pair passes (script exits 0, all checks pass)", () => {
    const r = spawnSync(process.execPath, [script], { encoding: "utf8" });
    expect(r.stderr).toBe("");
    const m = r.stdout.match(/(\d+)\/(\d+) checks pass/);
    expect(m).not.toBeNull();
    expect(m[1]).toBe(m[2]);
    expect(r.status).toBe(0);
  });
  it("fails when a check fails (a tokens file with --text equal to its background exits non-zero)", () => {
    const tokens = fileURLToPath(new URL("../../public/css/tokens.css", import.meta.url));
    const r = spawnSync(process.execPath, ["-e", `
      const fs=require("fs"),os=require("os"),p=require("path"),cp=require("child_process");
      const css=fs.readFileSync(${JSON.stringify(tokens)},"utf8").replace(/(--text:\\s*)#[0-9a-fA-F]{3,8}/,"$1#ffffff");
      const f=p.join(fs.mkdtempSync(p.join(os.tmpdir(),"c-")),"tokens.css");fs.writeFileSync(f,css);
      process.exit(cp.spawnSync(process.execPath,[${JSON.stringify(script)},f]).status);`], { encoding: "utf8" });
    expect(r.status).not.toBe(0);
  });
});
