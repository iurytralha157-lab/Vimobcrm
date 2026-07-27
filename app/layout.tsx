import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { RootProvider } from "@/components/providers/root-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"]
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"]
});

export const metadata: Metadata = {
  title: {
    default: "Vimob CRM",
    template: "%s | Vimob CRM",
  },
  applicationName: "Vimob CRM",
  description: "Sistema de gestao imobiliaria",
  appleWebApp: {
    capable: true,
    title: "Vimob CRM",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icons/favicon-laranja.png",
    apple: "/icons/favicon-laranja.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full" suppressHydrationWarning>
        <RootProvider>
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
