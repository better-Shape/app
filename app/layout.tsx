import type { Metadata } from "next";
import Script from "next/script";
import { SETTINGS_STORAGE_KEY } from "@/lib/settings/constants";
import "@fontsource-variable/inter";
import "@fontsource-variable/geist";
import "./globals.css";
import ClientLayout from "@/app/client-layout";

export const metadata: Metadata = {
  title: "BetterShape",
  description: "Agent workspace",
  icons: {
    icon: [
      { url: "/logos/app_icon.png", sizes: "512x512", type: "image/png" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    shortcut: "/favicon.ico",
    apple: "/logos/app_icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="dark h-full overflow-hidden text-sm bg-transparent text-text-primary"
      suppressHydrationWarning
    >
      <head>
        <Script
          id="bettershape-motion-preference"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `try { const settings = JSON.parse(localStorage.getItem("${SETTINGS_STORAGE_KEY}") || "null"); if (settings?.appearance?.motionPreference === "reduced") document.documentElement.dataset.motionPreference = "reduced"; } catch {}`,
          }}
        />
      </head>
      <body className="h-full flex flex-col overflow-hidden bg-transparent text-text-primary antialiased font-sans">
        <ClientLayout>
          {children}
        </ClientLayout>
      </body>
    </html>
  );
}
