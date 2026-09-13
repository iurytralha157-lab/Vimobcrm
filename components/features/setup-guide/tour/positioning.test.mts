import assert from "node:assert/strict";
import test from "node:test";

const positioningPath = "./positioning.ts";
const { clamp, getTourTooltipStyle } = await import(positioningPath);

test("centraliza o popover quando ainda não existe alvo ou viewport", () => {
  assert.deepEqual(getTourTooltipStyle(null, { width: 800, height: 600 }), {
    width: "min(340px, calc(100vw - 32px))",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
  });

  assert.deepEqual(
    getTourTooltipStyle(
      {
        bottom: 150,
        height: 50,
        left: 100,
        right: 180,
        top: 100,
        width: 80,
      },
      null,
    ),
    {
      width: "min(340px, calc(100vw - 32px))",
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
    },
  );
});

test("posiciona abaixo e limita o cartão às margens do viewport", () => {
  assert.deepEqual(
    getTourTooltipStyle(
      {
        bottom: 150,
        height: 50,
        left: 100,
        right: 180,
        top: 100,
        width: 80,
      },
      { width: 800, height: 600 },
    ),
    {
      width: 340,
      left: 16,
      top: 164,
      transform: "none",
      "--tour-arrow-position": "top",
    },
  );
});

test("posiciona acima quando não há espaço inferior", () => {
  assert.deepEqual(
    getTourTooltipStyle(
      {
        bottom: 550,
        height: 50,
        left: 300,
        right: 400,
        top: 500,
        width: 100,
      },
      { width: 800, height: 600 },
    ),
    {
      width: 340,
      left: 180,
      top: 296,
      transform: "none",
      "--tour-arrow-position": "bottom",
    },
  );
});

test("clamp preserva os mesmos limites numéricos do tour", () => {
  assert.equal(clamp(10, 16, 100), 16);
  assert.equal(clamp(80, 16, 100), 80);
  assert.equal(clamp(120, 16, 100), 100);
});
