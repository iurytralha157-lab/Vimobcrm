"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import {
  PrivateBroadcastRegistry,
  type PrivateBroadcastDiagnostic,
  type PrivateBroadcastStatus,
} from "@/lib/realtime/private-broadcast-registry";

type VimobSupabaseClient = SupabaseClient<Database>;

const registries = new WeakMap<VimobSupabaseClient, PrivateBroadcastRegistry>();

export function getPrivateBroadcastRegistry(
  client: VimobSupabaseClient,
  onDiagnostic?: (diagnostic: PrivateBroadcastDiagnostic) => void,
) {
  const existing = registries.get(client);
  if (existing) {
    if (onDiagnostic) existing.setDiagnosticReporter(onDiagnostic);
    return existing;
  }

  const registry = new PrivateBroadcastRegistry(
    {
      setAuth: () => client.realtime.setAuth(),
      open: ({ topic, event, onPayload, onStatus }) => {
        const channel = client
          .channel(topic, { config: { private: true } })
          .on("broadcast", { event }, ({ payload }) => onPayload(payload))
          .subscribe((status, error) => {
            onStatus(status as PrivateBroadcastStatus, error);
          });

        return {
          close: async () => {
            const result = await client.removeChannel(channel);
            if (result !== "ok") {
              throw new Error(`Supabase removeChannel returned "${result}"`);
            }
          },
        };
      },
    },
    { onDiagnostic },
  );
  registries.set(client, registry);
  return registry;
}
