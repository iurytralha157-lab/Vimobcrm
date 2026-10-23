import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCloudSource } from './cloud-baseline-contract.mjs';
import { buildCloudPlan } from './cloud-baseline-plan.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const usage = 'Usage: node scripts/staging/cloud-baseline-readiness.mjs [--target absolute-public-target.json] [--output absolute-plan.json]';

try {
  const options = {}, args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!['--target', '--output'].includes(flag) || options[flag] || !value || !path.isAbsolute(value)) throw new Error(usage);
    options[flag] = value;
  }
  const target = options['--target'] ? JSON.parse(await fs.readFile(options['--target'], 'utf8')) : null;
  const source = await loadCloudSource(repositoryRoot);
  const plan = buildCloudPlan(source, target);
  if (options['--output']) await fs.writeFile(options['--output'], `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ result: 'preparation-complete-cloud-installation-blocked', ready: plan.ready,
    databaseAccessed: false, executableSQLIncluded: false, baselineId: plan.source.baselineId,
    prefixMigrations: plan.source.prefixMigrations, reviewedForwards: plan.source.forwards.length,
    counts: plan.counts, unknownObjects: plan.unknownObjects.length, operationalLiteralRisks: plan.literalRisks.length,
    blockers: plan.blockers, planSaved: Boolean(options['--output']) }, null, 2));
} catch {
  // A rejected input path or JSON object could contain credentials. Do not echo it.
  console.error('Cloud preparation failed closed. Check source integrity, the public staging target contract and the output path. No database was accessed.');
  process.exitCode = 1;
}
