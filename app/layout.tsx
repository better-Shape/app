import type { Metadata } from "next";
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
      <body className="h-full flex flex-col overflow-hidden bg-transparent text-text-primary antialiased font-sans">
        <ClientLayout>
          {children}
        </ClientLayout>
      </body>
    </html>
  );
}
