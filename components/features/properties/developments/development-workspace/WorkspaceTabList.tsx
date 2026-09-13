import {
  Building2,
  CalendarClock,
  CircleDollarSign,
  DoorOpen,
  FileStack,
  History,
  Layers3,
} from 'lucide-react'

import { TabsList, TabsTrigger } from '@/components/ui/tabs'

export function WorkspaceTabList() {
  return (
            <div
              data-collapse="wide"
              className="app-responsive-tab-list min-w-0 flex-1"
            >
              <TabsList
                data-responsive-tab-scroll
                aria-label="Seções da ficha do empreendimento"
                className="flex h-auto w-fit max-w-full flex-nowrap justify-start overflow-x-auto rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-1.5 shadow-none"
              >
                <TabsTrigger
                  value="overview"
                  data-responsive-tab
                  aria-label="Visão geral"
                  title="Visão geral"
                  className="gap-2"
                >
                  <Building2 aria-hidden="true" className="h-4 w-4 shrink-0" />
                  <span className="app-responsive-tab-label">Visão geral</span>
                </TabsTrigger>
                <TabsTrigger
                  value="structure"
                  data-responsive-tab
                  aria-label="Estrutura"
                  title="Estrutura"
                  className="gap-2"
                >
                  <Layers3 aria-hidden="true" className="h-4 w-4 shrink-0" />
                  <span className="app-responsive-tab-label">Estrutura</span>
                </TabsTrigger>
                <TabsTrigger
                  value="floor-plans"
                  data-responsive-tab
                  aria-label="Plantas"
                  title="Plantas"
                  className="gap-2"
                >
                  <FileStack aria-hidden="true" className="h-4 w-4 shrink-0" />
                  <span className="app-responsive-tab-label">Plantas</span>
                </TabsTrigger>
                <TabsTrigger
                  value="units"
                  data-responsive-tab
                  aria-label="Espelho de unidades"
                  title="Espelho de unidades"
                  className="gap-2"
                >
                  <DoorOpen aria-hidden="true" className="h-4 w-4 shrink-0" />
                  <span className="app-responsive-tab-label">
                    Espelho de unidades
                  </span>
                </TabsTrigger>
                <TabsTrigger
                  value="reservations"
                  data-responsive-tab
                  aria-label="Reservas"
                  title="Reservas"
                  className="gap-2"
                >
                  <CalendarClock
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0"
                  />
                  <span className="app-responsive-tab-label">Reservas</span>
                </TabsTrigger>
                <TabsTrigger
                  value="commercial"
                  data-responsive-tab
                  aria-label="Comercial"
                  title="Comercial"
                  className="gap-2"
                >
                  <CircleDollarSign
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0"
                  />
                  <span className="app-responsive-tab-label">Comercial</span>
                </TabsTrigger>
                <TabsTrigger
                  value="history"
                  data-responsive-tab
                  aria-label="Histórico"
                  title="Histórico"
                  className="gap-2"
                >
                  <History aria-hidden="true" className="h-4 w-4 shrink-0" />
                  <span className="app-responsive-tab-label">Histórico</span>
                </TabsTrigger>
              </TabsList>
            </div>
  )
}
