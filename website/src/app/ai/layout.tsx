import type { Metadata } from "next";

export const metadata: Metadata = {
  openGraph: null,
  twitter: null,
};

export default function AILayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
