import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import ClientLayout from "@/components/layout/ClientLayout";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Frammer Analytics | Product Usage Dashboard",
  description:
    "Comprehensive analytics dashboard for Frammer AI - track video uploads, processing, publishing, and content performance across channels, teams, and platforms.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body>
        <Suspense fallback={<div style={{ minHeight: "100vh" }} />}>
          <ClientLayout>{children}</ClientLayout>
        </Suspense>
      </body>
    </html>
  );
}
