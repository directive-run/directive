import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "edge";

const BRAND_PRIMARY = "#0ea5e9";
const BRAND_ACCENT = "#6366f1";

// D Monogram mark as inline SVG data URI (Satori can't render complex <path> in JSX)
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-17.25 0 446.1 446.1" fill="none"><polygon points="105.5 445.12 105.48 446 0 446.1 0 .13 105.29 .15 105.5 445.12" fill="#94a3b8"/><path d="M105.48,446l.02-.88c.68-.39,1.78-1.14,2.7-2.07l110.1-110.61,15.59-15.76,90.58-91.02c1.37-1.51,2.2-2.81,2.74-4.24,2.86-1.6,5.24-3.72,7.91-6.4l64.26-64.55c5.93,22.62,11.7,45.66,12.17,69.86.56,28.8-4.32,56-14.29,82.95-19.91,53.8-59.13,98.45-111.34,122.77-28.36,13.21-53.68,20.05-85.67,20.02l-94.77-.07Z" fill="${BRAND_PRIMARY}"/><path d="M105.85.46l17.52-.46,77.95.27c51.09.17,98.81,21.03,136.61,54.53,8.01,7.1,15.23,14.59,21.99,22.86,12.65,15.47,32.54,46.44,37.36,64.8l2.1,8.02-64.26,64.55c-2.67,2.68-5.05,4.81-7.91,6.4-1-.77-1.92-1.56-3.31-2.95" fill="${BRAND_ACCENT}"/></svg>`;
const LOGO_DATA_URI = `data:image/svg+xml;base64,${typeof Buffer !== "undefined" ? Buffer.from(LOGO_SVG).toString("base64") : btoa(LOGO_SVG)}`;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get("title");
  const section = searchParams.get("section");

  if (!title) {
    return new Response('Missing required "title" parameter', { status: 400 });
  }

  const lexendData = await fetch(
    new URL("../../../fonts/lexend.woff2", import.meta.url),
  ).then((res) => res.arrayBuffer());

  const fontSize = title.length > 50 ? 48 : 56;

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
        position: "relative",
      }}
    >
      {/* Left accent stripe */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          backgroundColor: BRAND_PRIMARY,
        }}
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          padding: "48px 64px",
        }}
      >
        {/* Top: mark + wordmark lockup */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_DATA_URI} alt="" width={32} height={32} />
          <span
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "#94a3b8",
              letterSpacing: "0.08em",
              textTransform: "uppercase" as const,
              fontFamily: "Lexend",
            }}
          >
            DIRECTIVE
          </span>
        </div>

        {/* Middle: section label + title */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            maxWidth: 900,
          }}
        >
          {section && (
            <div
              style={{
                display: "flex",
                fontSize: 14,
                fontWeight: 600,
                color: BRAND_PRIMARY,
                letterSpacing: "0.08em",
                textTransform: "uppercase" as const,
                fontFamily: "Lexend",
              }}
            >
              {section}
            </div>
          )}
          <div
            style={{
              display: "flex",
              fontSize,
              fontWeight: 700,
              color: "#ffffff",
              lineHeight: 1.2,
              fontFamily: "Lexend",
            }}
          >
            {title}
          </div>
        </div>

        {/* Bottom: domain */}
        <div
          style={{
            display: "flex",
            fontSize: 14,
            color: "#64748b",
            fontFamily: "Lexend",
          }}
        >
          directive.run
        </div>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: "Lexend",
          data: lexendData,
          style: "normal",
          weight: 700,
        },
      ],
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    },
  );
}
