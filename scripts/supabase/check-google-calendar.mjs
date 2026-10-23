import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const supabasePackagePath = require.resolve("@supabase/supabase-js/package.json");
const supabasePackage = JSON.parse(readFileSync(supabasePackagePath, "utf8"));
const supabaseTypes = path.resolve(path.dirname(supabasePackagePath), supabasePackage.types);
const ambientPath = path.join(root, ".google-calendar-semantic-ambient.d.ts").replaceAll("\\", "/");
const ambient = `declare namespace Deno {
  namespace env { function get(name: string): string | undefined; }
  function serve(handler: (request: Request) => Response | Promise<Response>): unknown;
}
interface ImportMeta { readonly main: boolean; }`;
const options = { noEmit: true, allowImportingTsExtensions: true, skipLibCheck: true, strict: true, types: [],
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.es2023.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"] };
const host = ts.createCompilerHost(options);
const originalFileExists = host.fileExists.bind(host);
host.fileExists = file => file.replaceAll("\\", "/") === ambientPath || originalFileExists(file);
const originalReadFile = host.readFile.bind(host);
host.readFile = file => file.replaceAll("\\", "/") === ambientPath ? ambient : originalReadFile(file);
const originalGetSourceFile = host.getSourceFile.bind(host);
host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => file.replaceAll("\\", "/") === ambientPath
  ? ts.createSourceFile(file, ambient, languageVersion, true)
  : originalGetSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile);
host.resolveModuleNames = (names, containingFile) => names.map(name => name === "npm:@supabase/supabase-js@2"
  ? { resolvedFileName: supabaseTypes, extension: ts.Extension.Dts, isExternalLibraryImport: true }
  : ts.resolveModuleName(name, containingFile, options, host).resolvedModule);
const entries = ["google-calendar-oauth", "google-calendar-sync", "google-calendar-webhook", "google-calendar-auth"]
  .map(name => path.join(root, "supabase/functions", name, "index.ts"));
const program = ts.createProgram([...entries, ambientPath], options, host);
const diagnostics = ts.getPreEmitDiagnostics(program);
console.log(`Google Calendar: semantic check of ${entries.length} complete Edge entrypoints and imported shared modules; TypeScript ${ts.version}, installed supabase-js ${supabasePackage.version}.`);
console.log("Deno env/serve types supplied in memory. No services, env secrets, generated checkout files, or provider calls. Native deno check remains a release-runtime check.");
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => "\n",
  }));
  process.exitCode = 1;
} else console.log("PASS: zero semantic diagnostics.");
