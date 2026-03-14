"use client";

import { useLogoPreset } from "@/lib/LogoPresetContext";
import { DEFAULT_LOGO_PRESET, type LogoPath } from "@/lib/logo-presets";

const COLOR_ROLE_MAP = {
  primary: {
    fill: "var(--brand-primary)",
    stroke: "var(--brand-primary)",
  },
  accent: {
    fill: "var(--brand-accent)",
    stroke: "var(--brand-accent)",
  },
  bar: {
    fill: null,
    stroke: null,
  },
};

function resolvePathProps(path: LogoPath) {
  const isStroke = path.attrs.fill === "none";
  const props: Record<string, string | undefined> = { ...path.attrs };

  if (path.colorRole === "bar") {
    if (isStroke) {
      delete props.stroke;

      return { props, className: "stroke-slate-400 dark:stroke-slate-300" };
    }
    delete props.fill;

    return { props, className: "fill-slate-400 dark:fill-slate-300" };
  }

  const role = COLOR_ROLE_MAP[path.colorRole];
  if (isStroke) {
    props.stroke = role.stroke;
  } else {
    props.fill = role.fill;
  }

  return { props, className: undefined };
}

function PresetPaths() {
  const { preset } = useLogoPreset();

  return (
    <g>
      {preset.paths.map((path, i) => {
        const { props, className } = resolvePathProps(path);
        const Tag = path.tag;

        return <Tag key={i} {...props} className={className} />;
      })}
    </g>
  );
}

function parseViewBox(vb: string) {
  const [minX, , width, height] = vb.split(" ").map(Number);

  return { minX, width, height };
}

export function Logomark(props: React.ComponentPropsWithoutRef<"svg">) {
  const { preset } = useLogoPreset();

  return (
    <svg aria-hidden="true" viewBox={preset.viewBox} fill="none" {...props}>
      <PresetPaths />
    </svg>
  );
}

export function Logo(props: React.ComponentPropsWithoutRef<"svg">) {
  const { preset } = useLogoPreset();
  const { minX, height } = parseViewBox(preset.viewBox);

  // Derive text dimensions proportional to the coordinate space
  const fontSize = height * 0.493;
  const textY = height * 0.695;
  // fontSize * 4.5 ensures "directive" in Lexend fits at any viewBox scale
  const textWidth = fontSize * 4.5;
  const totalWidth = preset.lockupTextX + textWidth;

  return (
    <svg
      aria-hidden="true"
      viewBox={`${minX} 0 ${totalWidth} ${height}`}
      fill="none"
      {...props}
    >
      <PresetPaths />
      <text
        x={preset.lockupTextX}
        y={textY}
        className="fill-slate-900 dark:fill-white"
        style={{
          fontFamily: "var(--font-lexend), system-ui, sans-serif",
          fontSize: `${fontSize}px`,
          fontWeight: 500,
          letterSpacing: "-0.025em",
        }}
      >
        Directive
      </text>
    </svg>
  );
}

// Static mark for non-context use (favicon generation, OG images, etc.)
export function StaticLogomark(props: React.ComponentPropsWithoutRef<"svg">) {
  return (
    <svg
      aria-hidden="true"
      viewBox={DEFAULT_LOGO_PRESET.viewBox}
      fill="none"
      {...props}
    >
      <polygon
        points="105.5 445.12 105.48 446 0 446.1 0 .13 105.29 .15 105.5 445.12"
        className="fill-slate-400 dark:fill-slate-300"
      />
      <path
        d="M105.48,446l.02-.88c.68-.39,1.78-1.14,2.7-2.07l110.1-110.61,15.59-15.76,90.58-91.02c1.37-1.51,2.2-2.81,2.74-4.24,2.86-1.6,5.24-3.72,7.91-6.4l64.26-64.55c5.93,22.62,11.7,45.66,12.17,69.86.56,28.8-4.32,56-14.29,82.95-19.91,53.8-59.13,98.45-111.34,122.77-28.36,13.21-53.68,20.05-85.67,20.02l-94.77-.07Z"
        fill="var(--brand-primary)"
      />
      <path
        d="M105.85.46l17.52-.46,77.95.27c51.09.17,98.81,21.03,136.61,54.53,8.01,7.1,15.23,14.59,21.99,22.86,12.65,15.47,32.54,46.44,37.36,64.8l2.1,8.02-64.26,64.55c-2.67,2.68-5.05,4.81-7.91,6.4-1-.77-1.92-1.56-3.31-2.95"
        fill="var(--brand-accent)"
      />
    </svg>
  );
}
