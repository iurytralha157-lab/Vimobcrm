import Image from "next/image";

type AuthLogoProps = Readonly<{
  theme?: "dark" | "light" | "adaptive";
  width?: number;
}>;

export function AuthLogo({ theme = "dark", width = 148 }: AuthLogoProps) {
  if (theme === "adaptive") {
    return (
      <div className="mx-auto" style={{ width }}>
        <Image
          src="/images/logo-black.png"
          alt="Vimob"
          width={1228}
          height={429}
          sizes={`${width}px`}
          loading="eager"
          fetchPriority="high"
          className="h-auto w-full dark:hidden"
        />
        <Image
          src="/images/logo-white.png"
          alt="Vimob"
          width={1228}
          height={429}
          sizes={`${width}px`}
          loading="eager"
          fetchPriority="high"
          className="hidden h-auto w-full dark:block"
        />
      </div>
    );
  }

  return (
    <div className="mx-auto" style={{ width }}>
      <Image
        src={theme === "light" ? "/images/logo-black.png" : "/images/logo-white.png"}
        alt="Vimob"
        width={1228}
        height={429}
        sizes={`${width}px`}
        loading="eager"
        fetchPriority="high"
        style={{ width: "100%", height: "auto" }}
      />
    </div>
  );
}
