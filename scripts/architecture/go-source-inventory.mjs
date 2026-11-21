import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scanner = fileURLToPath(new URL("./go-source-inventory.go", import.meta.url));

export function readGoSource(mode, directory) {
  return JSON.parse(execFileSync("go", ["run", scanner, mode, directory], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }));
}
