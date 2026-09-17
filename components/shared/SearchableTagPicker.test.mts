import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./SearchableTagPicker.tsx", import.meta.url),
  "utf8",
);

test("picker compartilhado preserva busca, multisselecao e limite", () => {
  assert.match(source, /loading\?: boolean/);
  assert.match(source, /error\?: unknown/);
  assert.match(source, /triggerLabel\?: ReactNode/);
  assert.match(source, /triggerClassName\?: string/);
  assert.match(source, /searchTextIncludes\(tag\.name, search\)/);
  assert.match(source, /onToggleTag\(tagId\)/);
  assert.match(source, /aria-multiselectable="true"/);
  assert.match(source, /const DEFAULT_MAX_SELECTED_TAGS = 50/);
  assert.match(source, /!isSelected\(tagId\) && isAtLimit/);
  assert.doesNotMatch(source, /onToggleTag\(tag\.id\);\s*setOpen\(false\)/);
});

test("criacao de tag depende da permissao e selecoes indisponiveis podem ser removidas", () => {
  assert.match(
    source,
    /allowCreate && hasPermission\("tag_manage"\)[\s\S]*?&& !loading && !hasError/,
  );
  assert.match(source, /Criar nova tag/);
  assert.match(source, /unavailableTagIds\.map\(\(tagId\) =>/);
  assert.match(source, /aria-label="Remover tag indisponível"/);
  assert.match(source, /Não foi possível carregar as tags/);
});
