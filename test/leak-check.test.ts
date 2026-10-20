import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scan } from "../scripts/leak-check";

function run(content: string, deny: RegExp[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "leak-"));
  writeFileSync(join(dir, "f.txt"), content);
  return scan(["f.txt"], dir, deny).map((h) => h.rule);
}

test("synthetic order id and ASIN pass", () => {
  expect(run("000-0000001-0000001 B0SF000001 demo@example.com")).toEqual([]);
  expect(run("playwright@1.63.0 @axe-core/playwright@4.14.0")).toEqual([]); // lockfile name@version is not an email
});
test("real-shaped order id, unknown ASIN, private IP, host, email fail", () => {
  expect(run(["111", "2223334", "5556667"].join("-"))).toEqual(["amazon-order-id"]);
  expect(run("B0" + "ABCDEFGH")).toEqual(["asin"]);
  expect(run("host " + ["10", 1, 2, 3].join("."))).toEqual(["private-ip"]);
  expect(run("box.tail1234." + "ts.net")).toEqual(["tailnet-host"]);
  expect(run("me" + "@gmail.com")).toEqual(["email"]);
});
test("denylist hits are reported", () => {
  expect(run("sold by Acme Brand", [/acme brand/i])).toEqual(["denylist"]);
});
