import { ProtectedProvider } from "@/components/providers/protected-provider";

export default function ProtectedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <ProtectedProvider>{children}</ProtectedProvider>;
}
