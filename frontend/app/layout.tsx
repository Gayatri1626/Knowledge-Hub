import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { DomainProvider } from "@/lib/DomainContext";
import AppShell from "@/components/AppShell";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "KnowledgeHub",
  description: "Multi-document RAG assistant organized into domains",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full ${inter.variable}`}>
      <body className={`${inter.className} h-full bg-slate-50 text-slate-900 font-sans antialiased overflow-hidden`}>
        <DomainProvider>
          <AppShell>{children}</AppShell>
        </DomainProvider>
      </body>
    </html>
  );
}
