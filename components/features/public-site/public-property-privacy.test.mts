import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const publicScreens = readFileSync(
  new URL("./PublicSiteScreens.tsx", import.meta.url),
  "utf8",
);
const publicTypes = readFileSync(
  new URL("../../../lib/api/public-site-server.ts", import.meta.url),
  "utf8",
);

test("public property UI and contract exclude internal appraisal values", () => {
  for (const field of [
    "valor_venda_avaliado",
    "valor_locacao_avaliado",
  ]) {
    assert.equal(
      publicScreens.includes(field),
      false,
      `public UI references internal field ${field}`,
    );
    assert.equal(
      publicTypes.includes(field),
      false,
      `public property contract exposes internal field ${field}`,
    );
  }
});
