"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { usePropertyDevelopments } from "@/hooks/properties/use-property-developments";

import { DevelopmentCatalogCard, DevelopmentKpis } from "../developments/DevelopmentCatalogCard";

const SECTION_LIMIT = 8;

/** Empreendimentos above the launch fichas; hidden while nothing can be shown. */
export function LaunchDevelopmentsSection({ canManageCatalog }: { canManageCatalog: boolean }) {
  const query = usePropertyDevelopments({ limit: SECTION_LIMIT, offset: 0 });
  const response = query.data;
  const developments = response?.data ?? [];
  const canManage = response?.meta.can_manage ?? false;

  return (
    <>
      <DevelopmentKpis
        total={response?.meta.total}
        commercialActive={response?.meta.commercial_active}
        inventoryTotal={response?.meta.inventory_total}
        inventoryAvailable={response?.meta.inventory_available}
        underConstruction={response?.meta.under_construction}
      />
      {developments.length > 0 && (
        <section aria-label="Empreendimentos" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {developments.map((development) => (
            <DevelopmentCatalogCard key={development.id} development={development} canOpen={canManage} />
          ))}
        </section>
      )}
      {canManageCatalog && (
        <div className="flex justify-end">
          <Link
            href="/properties/developments"
            className="inline-flex items-center gap-1 text-[12px] font-light text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]"
          >
            Gerenciar empreendimentos, fases, torres e plantas
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
      )}
    </>
  );
}
