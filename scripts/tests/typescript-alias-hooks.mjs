import { existsSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const sourceExtensions = ["", ".ts", ".tsx", ".mts", "/index.ts", "/index.tsx"];
const compiledValidationRoot = join(repositoryRoot, ".validation-tests");

function resolveSourcePath(repositoryPath) {
  for (const extension of sourceExtensions) {
    const candidate = `${repositoryPath}${extension}`;
    // A package directory belongs to Node's resolver (index.js/package.json),
    // not to this TypeScript file resolver. Returning it as a file URL breaks
    // CJS dependencies used by the real Dashboard browser harness.
    if (existsSync(candidate) && statSync(candidate).isFile()) {
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
    const compiledValidation = context.parentURL?.startsWith(pathToFileURL(`${compiledValidationRoot}/`).href);
    if (compiledValidation && !specifier.startsWith("@/")) return nextResolve(specifier, context);
    if (specifier.startsWith("@/")) {
      // tsc preserves aliases in CommonJS output. Keep validation tests on
      // compiled JS rather than silently loading a second copy of TS source.
      if (compiledValidation) {
        const compiled = join(compiledValidationRoot, `${specifier.slice(2)}.js`);
        if (!existsSync(compiled)) throw new Error(`Missing compiled validation module: ${specifier}`);
        return { shortCircuit: true, url: pathToFileURL(compiled).href };
      }
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
