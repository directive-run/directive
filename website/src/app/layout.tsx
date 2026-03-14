import clsx from "clsx";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import {
  Bricolage_Grotesque,
  DM_Sans,
  Fira_Code,
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  Inter,
  JetBrains_Mono,
  Manrope,
  Outfit,
  Plus_Jakarta_Sans,
  Source_Code_Pro,
  Source_Sans_3,
  Space_Grotesk,
} from "next/font/google";
import localFont from "next/font/local";
import Script from "next/script";

import { Providers } from "@/app/providers";
import {
  OrganizationJsonLd,
  SoftwareJsonLd,
  WebsiteJsonLd,
} from "@/components/JsonLd";
import { Layout } from "@/components/Layout";
import { buildPresetInlineScript } from "@/lib/preset-inline-script";

import "@/styles/tailwind.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const lexend = localFont({
  src: "../fonts/lexend.woff2",
  display: "swap",
  variable: "--font-lexend",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-space-grotesk",
});

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-ibm-plex-sans",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-ibm-plex-mono",
});

const manrope = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-manrope",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

const outfit = Outfit({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-outfit",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-dm-sans",
});

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-plus-jakarta-sans",
});

const bricolageGrotesque = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-bricolage-grotesque",
});

const sourceSans3 = Source_Sans_3({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-source-sans-3",
});

const sourceCodePro = Source_Code_Pro({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-source-code-pro",
});

const firaCode = Fira_Code({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-fira-code",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://directive.run"),
  title: {
    template: "%s | Directive",
    default: "Directive - Constraint-Driven State Management for TypeScript",
  },
  description:
    "Directive is a constraint-driven runtime for TypeScript. Declare what must be true, define how to make it true, and let Directive orchestrate the rest. Built-in retry, timeout, time-travel debugging, and AI agent support.",
  keywords: [
    "TypeScript state management",
    "constraint-driven",
    "state machine",
    "reactive state",
    "declarative state",
    "Redux alternative",
    "Zustand alternative",
    "XState alternative",
    "React state management",
    "AI agent orchestration",
  ],
  authors: [{ name: "Sizls" }],
  creator: "Sizls",
  publisher: "Sizls",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://directive.run",
    siteName: "Directive",
    title: "Directive - Constraint-Driven State Management for TypeScript",
    description:
      "Declare what must be true. Define how to make it true. Let Directive handle the rest.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Directive - State that resolves itself",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Directive - Constraint-Driven State Management",
    description:
      "Declare what must be true. Define how to make it true. Let Directive handle the rest.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  alternates: {
    canonical: "https://directive.run",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={clsx(
        "h-full antialiased",
        inter.variable,
        lexend.variable,
        spaceGrotesk.variable,
        ibmPlexSans.variable,
        ibmPlexMono.variable,
        manrope.variable,
        jetbrainsMono.variable,
        outfit.variable,
        dmSans.variable,
        GeistSans.variable,
        GeistMono.variable,
        plusJakartaSans.variable,
        bricolageGrotesque.variable,
        sourceSans3.variable,
        sourceCodePro.variable,
        firaCode.variable,
      )}
      suppressHydrationWarning
    >
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />
        <link
          rel="alternate"
          type="application/rss+xml"
          title="Directive Blog"
          href="/blog/feed.xml"
        />
        {/* Preconnect to Fontshare CDN for faster font loading */}
        <link
          rel="preconnect"
          href="https://api.fontshare.com"
          crossOrigin="anonymous"
        />
        <link
          rel="preconnect"
          href="https://cdn.fontshare.com"
          crossOrigin="anonymous"
        />
        {/* Satoshi font from Fontshare CDN (for typography option 5) */}
        <link
          href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&f[]=general-sans@400,500,700&display=swap"
          rel="stylesheet"
        />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              :root {
                --font-satoshi: 'Satoshi', system-ui, -apple-system, sans-serif;
                --font-general-sans: 'General Sans', system-ui, sans-serif;
                --font-berkeley-mono: ui-monospace, 'SFMono-Regular', monospace;
              }
            `,
          }}
        />
        {/* Zero-flash preset application — runs before first paint */}
        <script
          dangerouslySetInnerHTML={{ __html: buildPresetInlineScript() }}
        />
        <OrganizationJsonLd />
        <WebsiteJsonLd />
        <SoftwareJsonLd />
      </head>
      <body className="flex min-h-full bg-brand-surface">
        <Providers>
          <Layout>{children}</Layout>
        </Providers>
        {process.env.NEXT_PUBLIC_GA_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GA_ID}`}
              strategy="afterInteractive"
            />
            <Script id="google-analytics" strategy="afterInteractive">
              {`window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${process.env.NEXT_PUBLIC_GA_ID}');`}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
