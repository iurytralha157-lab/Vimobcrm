"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { clearDistributionDraftsForUser } from "@/lib/round-robin/pending-draft";
import { clearTeamCreateIntentsForUser } from "@/lib/teams/team-create-intent";

// Complements the synchronous logout cache clear by tracking principal changes
// that stay within the same global Auth provider tree.
export function ManagementDraftLifecycle() {
  const { session } = useAuth();
  const previousUserId = useRef<string | null>(null);
  const userId = session?.user.id ?? null;

  useEffect(() => {
    const previous = previousUserId.current;
    if (previous && previous !== userId) {
      try {
        clearDistributionDraftsForUser(window.sessionStorage, previous);
        clearTeamCreateIntentsForUser(window.sessionStorage, previous);
      } catch {
        // Browsers may deny even reading the Storage object. Logout continues.
      }
    }
    previousUserId.current = userId;
  }, [userId]);

  return null;
}
