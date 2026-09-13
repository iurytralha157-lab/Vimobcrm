import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const propertyFormDirectory = dirname(fileURLToPath(import.meta.url));
const sectionDirectory = join(propertyFormDirectory, "sections");
const sectionFiles = [
  "OwnerSection.tsx",
  "StructureSection.tsx",
  "LocationSection.tsx",
  "ValuesSection.tsx",
  "CharacteristicsSection.tsx",
  "CommissionsSection.tsx",
  "ConfidentialSection.tsx",
  "ExtrasSection.tsx",
  "PublicationSection.tsx",
].map((fileName) => join(sectionDirectory, fileName));
const featureSelectorFile = join(propertyFormDirectory, "..", "FeatureSelector.tsx");
const formControlNames = new Set([
  "Input",
  "CurrencyInput",
  "Textarea",
  "SelectTrigger",
  "Switch",
]);

type JSXNode = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

function tagName(node: JSXNode) {
  return node.tagName.getText();
}

function attribute(node: JSXNode, name: string) {
  return node.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === name,
  );
}

function literalAttribute(node: JSXNode, name: string) {
  const property = attribute(node, name);
  return property?.initializer && ts.isStringLiteral(property.initializer)
    ? property.initializer.text
    : null;
}

function visitJSX(sourceFile: ts.SourceFile, visit: (node: JSXNode) => void) {
  const walk = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      visit(node);
    }
    ts.forEachChild(node, walk);
  };
  walk(sourceFile);
}

test("campos não-mídia mantêm labels associados e ids únicos", () => {
  const globalLiteralIds = new Map<string, string>();

  for (const filePath of [...sectionFiles, featureSelectorFile]) {
    const sourceText = readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const literalIds = new Set<string>();
    const literalLabels: string[] = [];

    visitJSX(sourceFile, (node) => {
      const name = tagName(node);
      const id = literalAttribute(node, "id");
      if (id) {
        assert.equal(
          globalLiteralIds.has(id),
          false,
          `id duplicado ${id} em ${filePath} e ${globalLiteralIds.get(id)}`,
        );
        globalLiteralIds.set(id, filePath);
        literalIds.add(id);
      }

      if (name === "Label") {
        const htmlFor = literalAttribute(node, "htmlFor");
        assert.ok(htmlFor, `Label sem htmlFor em ${filePath}`);
        literalLabels.push(htmlFor);
      }

      if (formControlNames.has(name)) {
        assert.ok(attribute(node, "id"), `${name} sem id em ${filePath}`);
      }
    });

    for (const htmlFor of literalLabels) {
      assert.ok(
        literalIds.has(htmlFor),
        `Label aponta para id ausente ${htmlFor} em ${filePath}`,
      );
    }
  }
});

test("seletores extras e busca de CEP anunciam estados assíncronos", () => {
  const featureSelector = readFileSync(featureSelectorFile, "utf8");
  const locationSection = readFileSync(
    join(sectionDirectory, "LocationSection.tsx"),
    "utf8",
  );

  assert.match(featureSelector, /role="status"/);
  assert.match(featureSelector, /aria-live="polite"/);
  assert.match(featureSelector, /aria-pressed=\{isSelected\}/);
  assert.match(locationSection, /id="property-cep-status"/);
  assert.match(locationSection, /role="status"/);
});
