import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const sourceExtensions = ["", ".ts", ".tsx", ".mts", "/index.ts", "/index.tsx"];

function resolveSourcePath(repositoryPath) {
  for (const extension of sourceExtensions) {
    const candidate = `${repositoryPath}${extension}`;
    if (existsSync(candidate)) {
      return {
        shortCircuit: true,
        url: pathToFileURL(candidate).href,
      };
    }
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const resolved = resolveSourcePath(
        join(repositoryRoot, specifier.slice(2)),
      );
      if (resolved) return resolved;
    }

    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      context.parentURL?.startsWith("file:")
    ) {
      const resolved = resolveSourcePath(
        fileURLToPath(new URL(specifier, context.parentURL)),
      );
      if (resolved) return resolved;
    }

    return nextResolve(specifier, context);
  },
});
