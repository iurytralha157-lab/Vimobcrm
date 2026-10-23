import type { MemberAvailabilitySnapshot } from "@/lib/api/teams";
import { availabilityToWeek, availabilityWeekReviewReason, type AvailabilityWeekReviewReason, type DaySchedule } from "./availability-week";

export type AvailabilityDraft = {
  scopeKey: string | null;
  revision: number | null;
  schedules: DaySchedule[];
  legacyConfirmed: boolean;
  reviewReason: AvailabilityWeekReviewReason | null;
};

export const EMPTY_AVAILABILITY_DRAFT: AvailabilityDraft = { scopeKey: null, revision: null, schedules: [], legacyConfirmed: false, reviewReason: null };

export type AvailabilityDraftAction =
  | { type: "observe" | "reload"; scopeKey: string; snapshot: MemberAvailabilitySnapshot }
  | { type: "edit"; scopeKey: string; update: (schedules: DaySchedule[]) => DaySchedule[] }
  | { type: "confirm"; scopeKey: string; confirmed: boolean }
  | { type: "close" };

export function availabilityDraftReducer(state: AvailabilityDraft, action: AvailabilityDraftAction): AvailabilityDraft {
  if (action.type === "close") return EMPTY_AVAILABILITY_DRAFT;
  if (action.type === "observe" || action.type === "reload") {
    // Server refreshes never replace a draft within the same opening. Only the
    // explicit reload action or a different tenant/member may hydrate it again.
    if (action.type === "observe" && state.scopeKey === action.scopeKey) return state;
    return {
      scopeKey: action.scopeKey,
      revision: action.snapshot.revision,
      schedules: availabilityToWeek(action.snapshot.availability),
      legacyConfirmed: availabilityWeekReviewReason(action.snapshot.availability) === null,
      reviewReason: availabilityWeekReviewReason(action.snapshot.availability),
    };
  }
  if (state.scopeKey !== action.scopeKey) return state;
  if (action.type === "confirm") return { ...state, legacyConfirmed: action.confirmed };
  if (action.type === "edit") return { ...state, schedules: action.update(state.schedules) };
  return state;
}
