import type { LogoPath, LogoPreset } from "@/lib/logo-presets";

const STATIC_COLORS = {
  primary: "#0ea5e9",
  accent: "#6366f1",
  bar: "#cbd5e1",
};

function resolveStaticProps(path: LogoPath) {
  const isStroke = path.attrs.fill === "none";
  const props: Record<string, string> = { ...path.attrs };
  const color = STATIC_COLORS[path.colorRole];

  if (isStroke) {
    props.stroke = color;
  } else {
    props.fill = color;
  }

  return props;
}

export function LogoPresetThumbnail({
  preset,
  size = 32,
}: {
  preset: LogoPreset;
  size?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox={preset.viewBox}
      fill="none"
      width={size}
      height={size}
    >
      {preset.paths.map((path, i) => {
        const props = resolveStaticProps(path);
        const Tag = path.tag;

        return <Tag key={i} {...props} />;
      })}
    </svg>
  );
}
