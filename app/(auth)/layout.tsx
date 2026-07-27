import { AuthShell } from "@/components/features/auth/auth-shell";

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <AuthShell>{children}</AuthShell>;
}
