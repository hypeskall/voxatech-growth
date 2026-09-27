import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Voxa Growth · VoxaTech",
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
      <body>{children}</body>
    </html>
  );
}
