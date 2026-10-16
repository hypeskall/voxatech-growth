import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import "./mobile.css";
const geist = Geist({
  subsets: ["latin", "latin-ext"],
  variable: "--font-geist",
  display: "swap",
});
export const metadata: Metadata = {
  title: "Voxa",
  description: "Sistemul intern de achiziție și vânzări VoxaTech",
  robots: { index: false, follow: false },
  icons: { icon: "/voxa-mark.png", apple: "/voxa-mark.png" },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Voxa" },
  applicationName: "Voxa",
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f7f8f7",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ro">
      <body className={geist.variable}>{children}</body>
    </html>
  );
}
