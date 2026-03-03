import type { Metadata } from "next";

export function buildPageMetadata(opts: {
  title: string;
  description: string;
  path: string;
  section?: string;
}): Metadata {
  const { title, description, path, section } = opts;
  const url = `https://directive.run${path}`;

  const ogImageParams = new URLSearchParams({ title });
  if (section) {
    ogImageParams.set("section", section);
  }
  const ogImageUrl = `https://directive.run/api/og?${ogImageParams.toString()}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: "Directive",
      type: "website",
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImageUrl],
    },
  };
}
