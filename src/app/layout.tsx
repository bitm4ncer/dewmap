import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { SafeAreaRoot } from "@/components/ui/SafeAreaRoot";
import { TactileRoot } from "@/components/ui/TactileRoot";
import { THEME } from "@/lib/theme";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_URL,
} from "@/lib/site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const TITLE = `${SITE_NAME} — ${SITE_TAGLINE}`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "dewmap",
    "map",
    "navigation",
    "public transport",
    "train",
    "rail",
    "hiking",
    "walking",
    "routes",
    "transit",
    "satellite imagery",
    "environmental data",
    "offline map",
    "client-side",
  ],
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: "navigation",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    siteName: SITE_NAME,
    title: TITLE,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: TITLE,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: SITE_DESCRIPTION,
    images: ["/og.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  appleWebApp: {
    capable: true,
    title: SITE_NAME,
    // Not `black-translucent`: on iOS 26 that opt-in is what leaves the
    // home-screen app with a strip below the layout viewport (WebKit 301108).
    // Without it the viewport reaches the physical bottom edge and the dock
    // sits flush; the status bar gets its own band in the page surface colour.
    statusBarStyle: "black",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // Must match the page surface: iOS tints the standalone chrome (and caches
  // it for the reserved bottom strip) from this colour.
  themeColor: THEME.surface0,
  width: "device-width",
  initialScale: 1,
  // Keep page zoom available (WCAG 1.4.4); MapLibre owns gestures on the
  // map canvas, so its pinch-zoom still works.
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: SITE_NAME,
  url: `${SITE_URL}/`,
  description: SITE_DESCRIPTION,
  applicationCategory: "TravelApplication",
  operatingSystem: "Any",
  browserRequirements: "Requires JavaScript and WebGL",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "EUR",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/*
          Legacy iOS standalone-mode opt-in. Next.js' appleWebApp metadata only
          emits the modern `mobile-web-app-capable`; older iOS versions still
          look for the apple-prefixed name to launch the home-screen icon
          fullscreen instead of inside Safari chrome.
        */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-[color:var(--surf-0)] text-[color:var(--ink)]">
        {children}
        <ServiceWorkerRegister />
        <SafeAreaRoot />
        <TactileRoot />
      </body>
    </html>
  );
}
