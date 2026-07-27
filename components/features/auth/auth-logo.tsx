import Image from "next/image";

type AuthLogoProps = Readonly<{
  theme?: "dark" | "light";
  width?: number;
}>;

export function AuthLogo({ theme = "dark", width = 148 }: AuthLogoProps) {
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
