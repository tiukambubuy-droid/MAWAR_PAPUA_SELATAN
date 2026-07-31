import type { Metadata } from "next";
import "./globals.css";
import "./ui-motion.css";

export const metadata: Metadata = {
  title: "MAWAR Papua Selatan | Dashboard Pemantauan Padi",
  description: "Dashboard pemantauan padi dan ketahanan pangan Provinsi Papua Selatan.",
  applicationName: "MAWAR Papua Selatan",
  openGraph: {
    title: "MAWAR Papua Selatan | Dashboard Pemantauan Padi",
    description: "Dashboard pemantauan padi dan ketahanan pangan Provinsi Papua Selatan.",
    siteName: "MAWAR Papua Selatan",
    locale: "id_ID",
    type: "website",
  },
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: [
      { url: "/branding/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/branding/icons/favicon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/branding/icons/app-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/branding/icons/app-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: [{ url: "/branding/icons/favicon-48.png", sizes: "48x48", type: "image/png" }],
    apple: [{ url: "/branding/icons/apple-touch-icon-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
