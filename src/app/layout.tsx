import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
const geist = Geist({
  subsets: ["latin", "latin-ext"],
  variable: "--font-geist",
  display: "swap",
});
export const metadata: Metadata = {
  title: "Voxa",
  description: "Sistemul intern de achiziție și vânzări VoxaTech",
  robots: { index: false, follow: false },
  icons: { icon: "/voxa-mark.png" },
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
