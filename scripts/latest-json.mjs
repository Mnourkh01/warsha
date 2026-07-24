// Builds latest.json for the Tauri updater from the NSIS bundle output.
// Run AFTER `pnpm tauri build` (with the signing key env set). Upload the three files
// it prints to the GitHub release: setup.exe, setup.exe.sig, latest.json.
//
// Usage: node scripts/latest-json.mjs ["release notes"]

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const conf = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const version = conf.version;
const nsisDir = join(root, "src-tauri", "target", "release", "bundle", "nsis");

const exe = readdirSync(nsisDir).find((f) => f.endsWith("-setup.exe"));
if (!exe) {
  console.error(`No *-setup.exe in ${nsisDir}. Run: pnpm tauri build`);
  process.exit(1);
}
let signature;
try {
  signature = readFileSync(join(nsisDir, `${exe}.sig`), "utf8").trim();
} catch {
  console.error(
    `${exe}.sig is missing. The build was not signed: set TAURI_SIGNING_PRIVATE_KEY ` +
      `(and TAURI_SIGNING_PRIVATE_KEY_PASSWORD) before pnpm tauri build.`,
  );
  process.exit(1);
}

const latest = {
  version,
  notes: process.argv[2] ?? `Warsha ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url: `https://github.com/Mnourkh01/warsha/releases/download/v${version}/${encodeURIComponent(exe)}`,
    },
  },
};

const out = join(nsisDir, "latest.json");
writeFileSync(out, JSON.stringify(latest, null, 2) + "\n");
console.log(`Wrote ${out}`);
console.log(`Release assets for v${version}:`);
console.log(`  ${join(nsisDir, exe)}`);
console.log(`  ${join(nsisDir, `${exe}.sig`)}`);
console.log(`  ${out}`);
