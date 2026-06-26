import Image from "next/image";
import { cn } from "@/lib/utils";

type VimobLoaderSize = "xs" | "sm" | "md" | "lg";

type VimobLoaderProps = {
  className?: string;
  iconClassName?: string;
  label?: string;
  showLabel?: boolean;
  size?: VimobLoaderSize;
};

const sizeClasses: Record<VimobLoaderSize, string> = {
  xs: "h-4 w-4",
  sm: "h-[18px] w-[18px]",
  md: "h-9 w-9",
  lg: "h-14 w-14",
};

export function VimobLoader({
  className,
  iconClassName,
  label = "Carregando...",
  showLabel = false,
  size = "md",
}: VimobLoaderProps) {
  return (
    <span
      aria-label={label}
      className={cn(
        "inline-flex items-center justify-center gap-2",
        showLabel && "text-sm font-light text-muted-foreground",
        className,
      )}
      role="status"
    >
      <Image
        src="/favicon.ico"
        alt=""
        aria-hidden
        width={48}
        height={48}
        loading={size === "lg" ? "eager" : "lazy"}
        className={cn("vimob-loader-pulse shrink-0", sizeClasses[size], iconClassName)}
        unoptimized
      />
      {showLabel ? <span>{label}</span> : <span className="sr-only">{label}</span>}
    </span>
  );
}
