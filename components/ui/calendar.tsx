import * as React from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({ className, classNames, components, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("relative p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4",
        month_caption: "relative flex h-8 items-center justify-center",
        caption_label: "text-sm font-medium",
        nav: "absolute left-3 right-3 top-3 z-10 flex items-center justify-between",
        button_previous: cn(
          buttonVariants({ variant: "ghost" }),
          "h-7 w-7 rounded-[6px] border-0 bg-transparent p-0 text-muted-foreground shadow-none hover:bg-[var(--app-surface-hover)] hover:text-foreground",
        ),
        button_next: cn(
          buttonVariants({ variant: "ghost" }),
          "h-7 w-7 rounded-[6px] border-0 bg-transparent p-0 text-muted-foreground shadow-none hover:bg-[var(--app-surface-hover)] hover:text-foreground",
        ),
        month_grid: "w-full border-collapse space-y-1",
        weekdays: "flex",
        weekday: "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]",
        week: "flex w-full mt-2",
        day: "relative h-9 w-9 p-0 text-center text-sm focus-within:relative focus-within:z-20 [&>button]:relative [&>button]:z-10",
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 rounded-[6px] p-0 font-normal transition-colors hover:bg-[var(--app-surface-hover)] hover:text-foreground aria-selected:opacity-100",
        ),
        selected:
          "bg-transparent [&>button]:!rounded-[6px] [&>button]:!bg-primary [&>button]:!text-primary-foreground hover:[&>button]:!bg-primary focus:[&>button]:!bg-primary",
        today: "[&>button]:rounded-[6px] [&>button]:bg-primary/10 [&>button]:text-primary hover:[&>button]:bg-primary/15",
        outside:
          "outside text-muted-foreground opacity-50 aria-selected:bg-primary/10 aria-selected:text-muted-foreground aria-selected:opacity-30",
        disabled: "text-muted-foreground opacity-50",
        range_start:
          "!rounded-l-[6px] !rounded-r-none !bg-primary/15 [&>button]:!rounded-[6px] [&>button]:!bg-primary [&>button]:!text-primary-foreground",
        range_middle:
          "!rounded-none !bg-primary/15 [&>button]:!rounded-none [&>button]:!bg-transparent [&>button]:!text-foreground hover:[&>button]:!rounded-[6px] hover:[&>button]:!bg-primary hover:[&>button]:!text-primary-foreground focus-within:[&>button]:!rounded-[6px] focus-within:[&>button]:!bg-primary focus-within:[&>button]:!text-primary-foreground",
        range_end:
          "!rounded-l-none !rounded-r-[6px] !bg-primary/15 [&>button]:!rounded-[6px] [&>button]:!bg-primary [&>button]:!text-primary-foreground",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ className: chevronClassName, orientation, size = 16, ...chevronProps }) => {
          const Icon =
            orientation === "left"
              ? ChevronLeft
              : orientation === "up"
                ? ChevronUp
                : orientation === "down"
                  ? ChevronDown
                  : ChevronRight;

          return <Icon className={cn("h-4 w-4", chevronClassName)} size={size} {...chevronProps} />;
        },
        ...components,
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
