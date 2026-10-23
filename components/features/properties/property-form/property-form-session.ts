import { VimobAPIError } from "@/lib/api/vimob-error";

export type PropertyFormAction = {
  expectedSessionId: string | null;
  isCurrent: () => boolean;
  assertCurrent: () => void;
};

/** Capture once per gesture; JWT refresh within this session remains valid. */
export function capturePropertyFormAction(
  isScopeCurrent: () => boolean,
  readSessionId: () => string | null,
): PropertyFormAction {
  const expectedSessionId = readSessionId();
  const isCurrent = () => Boolean(expectedSessionId)
    && isScopeCurrent() && readSessionId() === expectedSessionId;
  const assertCurrent = () => {
    if (!isCurrent()) throw new VimobAPIError("A sessão ou o acesso ao imóvel mudou. Reabra a operação antes de continuar.", {
      code: "property_action_scope_changed", status: 409,
    });
  };
  return { expectedSessionId, isCurrent, assertCurrent };
}
