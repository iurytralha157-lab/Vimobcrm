import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSQLArtifact } from './local-schema-baseline-artifacts.mjs';

test('original dump guards remain bounded and permit exact pg_dump restrict lines', () => {
  assertSQLArtifact("\\restrict abc123\nSET statement_timeout = '5min';\nSET lock_timeout='5s';\ncreate schema example;\n\\unrestrict abc123");
  for (const source of ['\\connect postgres', '\\! arbitrary', 'create schema supabase_migrations;',
    'create table vimob_local_bootstrap.history(file text);', 'SET statement_timeout = 0;', "SET lock_timeout = '0';"]) {
    assert.throws(() => assertSQLArtifact(source));
  }
});

for (const [name, source] of [
  ['leading-space reconnect', ' \\connect postgres'],
  ['tab shell', '\t\\! arbitrary'],
  ['inline reconnect', 'select 1; \\connect postgres'],
  ['inline shell after comment', 'select 1; /* safe */ \\! arbitrary'],
  ['all other psql commands', '\\i another.sql'],
  ['psql send and execute', 'select 1 \\gexec'],
  ['psql pipe', 'select 1 \\g | shell'],
  ['psql variable assignment', '\\set target postgres'],
  ['double backslash separator', 'select 1; \\\\ \\connect postgres'],
  ['indented restrict is not original pg_dump', ' \\restrict abc123'],
  ['inline restrict', 'select 1; \\restrict abc123'],
  ['restrict with shell appended', '\\restrict abc123 \\! arbitrary'],
  ['restrict with extra token', '\\restrict abc123 other'],
  ['unrestrict with token punctuation', '\\unrestrict abc123;'],
  ['unrestrict followed by inline reconnect', '\\unrestrict abc123 \\connect postgres'],
  ['meta after a closed dollar body', 'do $$ begin null; end $$; \\connect postgres'],
  ['meta after a closed string', "select 'safe'; \\connect postgres"],
  ['meta after an escaped quote', "select E'escaped\\\'quote'; \\connect postgres"],
  ['meta after nested block comment', '/* outer /* nested */ done */\t\\connect postgres'],
]) test(`reject ${name}`, () => assert.throws(() => assertSQLArtifact(source), /metacommands/));

for (const source of [
  'CREATE UNLOGGED TABLE supabase_migrations.schema_migrations(version text);',
  'CREATE TEMPORARY TABLE vimob_local_bootstrap.history(file text);',
  'CREATE TEMP TABLE IF NOT EXISTS "vimob_local_bootstrap"."history"(file text);',
  'CREATE GLOBAL TEMP TABLE "supabase_migrations".history(file text);',
  'CREATE LOCAL TEMPORARY TABLE IF NOT EXISTS supabase_migrations.history(file text);',
  'CREATE /* gap */ UNLOGGED /* gap */ TABLE IF /* gap */ NOT EXISTS "vimob_local_bootstrap" . history(file text);',
  'CREATE SCHEMA IF NOT EXISTS "supabase_migrations";',
  'CREATE SCHEMA "vimob_local_bootstrap" AUTHORIZATION postgres;',
  'CREATE SCHEMA AUTHORIZATION supabase_migrations;',
  'CREATE SCHEMA IF NOT EXISTS AUTHORIZATION "vimob_local_bootstrap";',
  'CREATE SCHEMA U&"supabase_\\006digrations";',
  "CREATE SCHEMA U&\"vimob_!006cocal_bootstrap\" UESCAPE '!';",
  'CREATE SEQUENCE private.lead_distribution_ticket_0123456789abcdef0123456789abcdef;',
  'CREATE TEMP SEQUENCE "private"."lead_distribution_ticket_0123456789abcdef0123456789abcdef";',
  'CREATE SEQUENCE IF NOT EXISTS private."lead_distribution_ticket_0123456789abcdef0123456789abcdef";',
]) test(`reject protected DDL: ${source}`, () => assert.throws(() => assertSQLArtifact(source), /migration ledger/));

for (const source of [
  'SET LOCAL statement_timeout TO 0;',
  'set session "lock_timeout" = +0;',
  "SET /* bound */ statement_timeout TO '0ms';",
  "SET lock_timeout = ' 0 s ';",
  'SET standard_conforming_strings = off;',
  "SET standard_conforming_strings = 'OFF';",
  String.raw`SET lock_timeout = E'\060';`,
  String.raw`SET statement_timeout = E'\x30ms';`,
  String.raw`SET lock_timeout = E'\u0030';`,
  String.raw`SET statement_timeout = E'\U00000030';`,
  'SET LOCAL transaction_timeout = 0;',
  'SET SESSION "transaction_timeout" TO +0;',
  "SET transaction_timeout = '0ms';",
  String.raw`SET transaction_timeout = E'\060';`,
  String.raw`SET transaction_timeout = E'\x30';`,
  String.raw`SET transaction_timeout = E'\u0030';`,
  'SET LOCAL statement_timeout = .0;',
  'SET lock_timeout TO -0.00;',
  "SET transaction_timeout = '0.0 ms';",
  'SET "LOCK_TIMEOUT" = 0;',
  'SET LOCAL "TRANSACTION_TIMEOUT" TO 0;',
  'SET standard_conforming_strings = no;',
  "SET standard_conforming_strings = 'f';",
  "SET standard_conforming_strings = 'of';",
]) test(`reject timeout/parser mode escape: ${source}`, () => assert.throws(() => assertSQLArtifact(source)));

test('SQL strings, quoted identifiers, regexes, dollar bodies and comments preserve literal backslashes', () => {
  assertSQLArtifact(String.raw`\restrict abc123
SET statement_timeout = '5min';
SET lock_timeout = '5s';
SET standard_conforming_strings = on;
SELECT '\connect postgres', '\! literal', E'escaped\'quote \\connect literal';
SELECT '\\d+\\s*', '\restrict arbitrary extra tokens';
SELECT 1 AS "\connect literal";
SELECT $$
\connect postgres
\! literal in dollar SQL
create schema supabase_migrations;
$$;
CREATE FUNCTION public.literal_demo() RETURNS text LANGUAGE sql AS $body$
  SELECT '\! literal'; -- body is opaque to psql
$body$;
/* \connect literal /* nested \! */ comment */
-- \! literal comment
CREATE TABLE public.example(value text);
CREATE SCHEMA "ordinary";
\unrestrict abc123
`);
});

test('doubled SQL quotes and Unicode identifiers retain SQL semantics', () => {
  assertSQLArtifact("SELECT 'literal '' \\connect still literal'; SELECT 1 AS \"quote\"\" \\! literal\";");
  assertSQLArtifact('CREATE TABLE public."supabase_migrations"(value text); CREATE SCHEMA "SUPABASE_MIGRATIONS";');
  assertSQLArtifact('CREATE SCHEMA U&"ordinary_\\0061";');
});

test('dynamic ticket sequence creation inside a function body remains schema code', () => {
  assertSQLArtifact(String.raw`CREATE FUNCTION private.ensure_ticket() RETURNS void LANGUAGE plpgsql AS $function$
BEGIN
  EXECUTE format('CREATE SEQUENCE IF NOT EXISTS private.lead_distribution_ticket_%s', '0123456789abcdef0123456789abcdef');
END
$function$;`);
});

for (const source of ["select 'unclosed", 'select E\'escape\\', 'select "unclosed', 'do $body$ begin null;', '/* outer /* nested */', 'select 1;\0']) {
  test('malformed SQL never creates a false opaque region', () => assert.throws(() => assertSQLArtifact(source)));
}
