"use client";

import Link from "next/link";
import {
  Building2,
  Construction,
  KeyRound,
  MapPinned,
  Settings2,
  UserRound,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUserPermissions } from "@/hooks/use-user-permissions";

export type PropertySection =
  | "all"
  | "developments"
  | "rentals"
  | "condominiums"
  | "locations"
  | "owners"
  | "settings";

type PropertySectionItem = {
  value: PropertySection;
  label: string;
  href: string;
  icon: LucideIcon;
  manageOnly?: boolean;
  permission?: "settings_organization";
};

const PROPERTY_SECTIONS: PropertySectionItem[] = [
  {
    value: "all",
    label: "Todos os imóveis",
    href: "/properties",
    icon: Building2,
  },
  {
    value: "developments",
    label: "Lançamentos",
    href: "/properties/launches",
    icon: Construction,
  },
  {
    value: "rentals",
    label: "Aluguel",
    href: "/properties/rentals",
    icon: KeyRound,
  },
  {
    value: "condominiums",
    label: "Condomínios",
    href: "/properties/condominiums",
    icon: Warehouse,
    manageOnly: true,
  },
  {
    value: "locations",
    label: "Localidades",
    href: "/properties/locations",
    icon: MapPinned,
    manageOnly: true,
  },
  {
    value: "owners",
    label: "Proprietários",
    href: "/properties/owners",
    icon: UserRound,
    manageOnly: true,
  },
  {
    value: "settings",
    label: "Configurações",
    href: "/properties/settings",
    icon: Settings2,
    permission: "settings_organization",
  },
];

type PropertySectionTabsProps = {
  activeSection: PropertySection;
};

export function PropertySectionTabs({
  activeSection,
}: PropertySectionTabsProps) {
  const { hasPermission } = useUserPermissions();
  const canManageProperties = hasPermission("property_manage");
  const canConfigureProperties = hasPermission("settings_organization");
  const canViewProperties =
    canManageProperties || hasPermission("property_view");
  const visibleSections = PROPERTY_SECTIONS.filter(
    (section) =>
      section.permission
        ? canConfigureProperties
        : section.manageOnly
          ? canManageProperties
          : canViewProperties,
  );

  return (
    <Tabs value={activeSection} className="min-w-0">
      <div
        className="app-responsive-tab-list min-w-0 flex-1"
        data-collapse="compact"
      >
        <TabsList
          aria-label="Seções de imóveis"
          data-responsive-tab-scroll
          className="inline-flex h-8 w-fit max-w-full justify-start overflow-x-auto rounded-[8px] bg-[var(--app-surface-soft)] p-1 text-[var(--app-text-secondary)] shadow-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {visibleSections.map((section) => {
            const Icon = section.icon;

            return (
              <TabsTrigger
                key={section.value}
                value={section.value}
                asChild
                data-responsive-tab
                className="mx-0 h-6 shrink-0 gap-1 rounded-[6px] px-2.5 text-[10px] font-light shadow-none data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:text-[var(--app-text-primary)] data-[state=active]:shadow-none sm:text-[12px]"
              >
                <Link
                  href={section.href}
                  aria-label={section.label}
                  aria-current={
                    section.value === activeSection ? "page" : undefined
                  }
                  title={section.label}
                >
                  <Icon className="h-3 w-3" aria-hidden="true" />
                  <span className="app-responsive-tab-label">
                    {section.label}
                  </span>
                </Link>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>
    </Tabs>
  );
}
