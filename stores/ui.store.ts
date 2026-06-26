import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UIStore {
  // Sidebar
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void

  // Modals
  modalsOpen: Record<string, boolean>
  openModal: (id: string) => void
  closeModal: (id: string) => void
  closeAllModals: () => void

  // Floating elements
  floatingChatOpen: boolean
  setFloatingChatOpen: (open: boolean) => void

  // Theme
  theme: 'light' | 'dark' | 'system'
  setTheme: (theme: 'light' | 'dark' | 'system') => void
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      // Sidebar
      sidebarOpen: true,
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

      // Modals
      modalsOpen: {},
      openModal: (id) =>
        set((state) => ({
          modalsOpen: { ...state.modalsOpen, [id]: true },
        })),
      closeModal: (id) =>
        set((state) => ({
          modalsOpen: { ...state.modalsOpen, [id]: false },
        })),
      closeAllModals: () => set({ modalsOpen: {} }),

      // Floating chat
      floatingChatOpen: false,
      setFloatingChatOpen: (floatingChatOpen) => set({ floatingChatOpen }),

      // Theme
      theme: 'system',
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'ui-store',
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        theme: state.theme,
      }),
    }
  )
)
