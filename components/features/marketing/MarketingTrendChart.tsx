"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart";

interface MarketingTrendChartProps {
  data: Array<{
    date: string;
    leads: number;
    conversations: number;
    total: number;
  }>;
}

function formatDate(value: string) {
  const parsed = new Date(`${value}T12:00:00`);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  }).format(parsed);
}

export function MarketingTrendChart({ data }: MarketingTrendChartProps) {
  return (
    <ChartContainer
      config={{
        leads: { label: "Leads", color: "var(--chart-1)" },
        conversations: { label: "Conversas", color: "var(--chart-2)" },
      }}
      className="h-[250px] w-full"
      aria-label="Evolução diária de leads e conversas"
    >
      <AreaChart data={data} margin={{ left: -12, right: 8, top: 12, bottom: 0 }}>
        <defs>
          <linearGradient id="marketing-leads-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="marketing-conversations-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.22} />
            <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" strokeOpacity={0.14} />
        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          fontSize={10}
        />
        <YAxis
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          fontSize={10}
        />
        <ChartTooltip />
        <Area
          type="monotone"
          dataKey="leads"
          stroke="var(--color-leads)"
          strokeWidth={2}
          fill="url(#marketing-leads-fill)"
        />
        <Area
          type="monotone"
          dataKey="conversations"
          stroke="var(--color-conversations)"
          strokeWidth={2}
          fill="url(#marketing-conversations-fill)"
        />
      </AreaChart>
    </ChartContainer>
  );
}
