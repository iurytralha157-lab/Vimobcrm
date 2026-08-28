"use client";

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

const ManagementToolbarContext = createContext<HTMLElement | null>(null);

interface ManagementToolbarProviderProps {
  children: ReactNode;
  target: HTMLElement | null;
}

export function ManagementToolbarProvider({
  children,
  target,
}: ManagementToolbarProviderProps) {
  return (
    <ManagementToolbarContext.Provider value={target}>
      {children}
    </ManagementToolbarContext.Provider>
  );
}

export function ManagementToolbarPortal({ children }: { children: ReactNode }) {
  const target = useContext(ManagementToolbarContext);

  if (!target) return null;

  return createPortal(children, target);
}
