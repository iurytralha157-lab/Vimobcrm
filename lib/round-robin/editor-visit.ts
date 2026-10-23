/** A request may only finish the visit and operation that started it. */
export function createDistributionEditorVisit() {
  type Visit = { active: boolean; operation: object | null };
  let current: Visit | null = null;

  return {
    activate() {
      const visit: Visit = { active: true, operation: null };
      current = visit;
      return () => {
        visit.active = false;
        if (current === visit) current = null;
      };
    },
    isBusy: () => Boolean(current?.active && current.operation),
    beginOperation() {
      const visit = current;
      if (!visit?.active || visit.operation) return null;
      const operation = {};
      visit.operation = operation;
      const isCurrent = () => current === visit && visit.active && visit.operation === operation;
      return {
        isCurrent,
        finish() {
          if (!isCurrent()) return false;
          visit.operation = null;
          return true;
        },
      };
    },
  };
}
