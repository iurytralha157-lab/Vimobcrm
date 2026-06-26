import * as React from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export interface AnimatedTabItem {
  value: string;
  label: string;
  icon: React.ElementType<{ className?: string }>;
  badge?: number | string;
  /** Custom icon render (e.g. for WhatsAppIcon or AnimatedIcon) */
  renderIcon?: () => React.ReactNode;
}

interface AnimatedTabNavProps {
  tabs: AnimatedTabItem[];
  activeTab: string;
  onTabChange: (value: string) => void;
  className?: string;
}

export function AnimatedTabNav({ tabs, activeTab, onTabChange, className }: AnimatedTabNavProps) {
  return (
    <nav className={cn("animated-tab-nav", className)}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.value;
        return (
          <button
            key={tab.value}
            onClick={() => onTabChange(tab.value)}
            className={cn("animated-tab-link", isActive && "active")}
            type="button"
          >
            <span className="animated-tab-icon">
              {tab.renderIcon ? (
                tab.renderIcon()
              ) : (
                <tab.icon className="h-[18px] w-[18px]" />
              )}
            </span>
            <span className="animated-tab-title">
              {tab.label}
              {tab.badge !== undefined && (
                <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0 min-w-[18px] text-center">
                  {tab.badge}
                </Badge>
              )}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
