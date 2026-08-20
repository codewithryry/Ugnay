import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

/**
 * Public origin used for canonical and social URLs. Set NEXT_PUBLIC_SITE_URL for
 * the deployed site; the dev origin is the fallback so nothing is invented.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const DESCRIPTION =
  "Ugnay is a fast, minimal AI chat app: talk to multiple AI models in one place, " +
  "with saved conversations, custom instructions and a clean dark interface.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Ugnay", template: "%s | Ugnay" },
  description: DESCRIPTION,
  applicationName: "Ugnay",
  keywords: [
    "Ugnay",
    "AI chat",
    "AI chat app",
    "AI assistant",
    "chatbot",
    "OpenRouter",
    "DeepSeek",
    "Taglish AI",
  ],
  alternates: { canonical: "/" },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  openGraph: {
    type: "website",
    siteName: "Ugnay",
    title: "Ugnay — AI chat app",
    description: DESCRIPTION,
    url: SITE_URL,
    images: [
      {
        url: "/logo/logo-512.png",
        width: 512,
        height: 512,
        alt: "Ugnay logo",
        type: "image/png",
      },
    ],
  },
  twitter: {
    // A square logo reads correctly in the summary card.
    card: "summary",
    title: "Ugnay — AI chat app",
    description: DESCRIPTION,
    images: [{ url: "/logo/logo-512.png", alt: "Ugnay logo" }],
  },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/logo/logo-256.png", sizes: "256x256", type: "image/png" },
      { url: "/logo/logo-192.png", sizes: "192x192", type: "image/png" },
      { url: "/logo/Logo.png", sizes: "1254x1254", type: "image/png" },
    ],
    apple: [{ url: "/logo/logo-512.png", sizes: "512x512", type: "image/png" }],
    shortcut: [{ url: "/logo/logo-256.png", sizes: "256x256", type: "image/png" }],
  },
  // Installed-PWA chrome on iOS, which ignores the manifest.
  appleWebApp: { capable: true, title: "Ugnay", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  width: "device-width",
  initialScale: 1,
  // No maximumScale: pinch-zoom stays available. `cover` lets the app paint
  // under the notch and home indicator; the safe-area insets in globals.css
  // keep the controls clear of them.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <script
          // Mirrors lib/theme.ts; runs before paint to avoid a theme flash.
          dangerouslySetInnerHTML={{
            __html: `try{var c=localStorage.getItem("ugnay-theme")||"dark";document.documentElement.dataset.theme=c==="system"?(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):c}catch(e){document.documentElement.dataset.theme="dark"}`,
          }}
        />
      </head>
      <body className="h-full overflow-x-hidden font-sans">{children}</body>
    </html>
  );
}
