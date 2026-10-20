// Leak gate: fails when a file that would be committed holds private data.
// Generic rules live here (public). The private denylist (business names, hosts, vault keys) is NOT in the repo:
// one regex per line, case-insensitive, in $SELLERFIELD_LEAK_DENYLIST or ~/.config/sellerfield/leak-denylist.txt.
// Without it the gate fails, except in CI (CI=true), where only the generic rules and gitleaks run.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export type Hit = { file: string; line: number; rule: string; text: string };

const SYNTHETIC_ASIN = /^B0SF0000\d\d$/;
const RULES: { rule: string; re: RegExp; allow?: (m: string) => boolean }[] = [
  { rule: "amazon-order-id", re: /\b\d{3}-\d{7}-\d{7}\b/g, allow: (m) => m.startsWith("000-") },
  { rule: "asin", re: /\bB0[A-Z0-9]{8}\b/g, allow: (m) => SYNTHETIC_ASIN.test(m) },
  { rule: "private-ip", re: /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g },
  { rule: "tailnet-host", re: /\b[\w.-]+\.ts\.net\b/g },
  { rule: "notion-id", re: /\b[0-9a-f]{32}\b/g },
  { rule: "email", re: /[\w.+-]+@[\w-]+(?:\.[A-Za-z][\w-]*)+/g, allow: (m) => /@(example\.(com|org)|sellerfield\.com|users\.noreply\.github\.com)$/i.test(m) },
];

export function loadDenylist(path: string): RegExp[] {
  return readFileSync(path, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => new RegExp(l, "i"));
}

export function scan(files: string[], root: string, deny: RegExp[]): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    let text: string;
    try { text = readFileSync(join(root, file), "utf8"); } catch { continue; }
    if (text.includes("\0")) continue;
    text.split("\n").forEach((line, i) => {
      for (const { rule, re, allow } of RULES)
        for (const m of line.matchAll(re)) if (!allow?.(m[0])) hits.push({ file, line: i + 1, rule, text: m[0] });
      for (const re of deny) {
        const m = line.match(re);
        if (m) hits.push({ file, line: i + 1, rule: "denylist", text: m[0] });
      }
    });
  }
  return hits;
}

function git(root: string, args: string[]) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
}

if (import.meta.main) {
  const root = join(import.meta.dir, "..");
  const ci = process.env.CI === "true";
  const denyPath = process.env.SELLERFIELD_LEAK_DENYLIST ?? join(homedir(), ".config", "sellerfield", "leak-denylist.txt");
  let deny: RegExp[] = [];
  let failed = false;
  if (existsSync(denyPath)) deny = loadDenylist(denyPath);
  else if (!ci) { console.error(`leak-check: private denylist missing (${denyPath})`); failed = true; }

  // everything git would commit: tracked plus untracked-not-ignored
  const files = git(root, ["ls-files", "-co", "--exclude-standard"]);
  const hits = scan(files, root, deny);
  for (const h of hits) console.error(`leak-check: ${h.file}:${h.line} [${h.rule}] ${h.text}`);
  if (hits.length) failed = true;

  const gl = spawnSync("gitleaks", ["detect", "--no-git", "--source", root, "--no-banner", "--redact"], { encoding: "utf8" });
  if (gl.error) { console.error("leak-check: gitleaks not installed"); failed = true; }
  else if (gl.status !== 0) { console.error(gl.stdout + gl.stderr); failed = true; }

  if (failed) process.exit(1);
  console.log(`leak-check: ${files.length} files clean (${deny.length} private rules, gitleaks ok)`);
}
