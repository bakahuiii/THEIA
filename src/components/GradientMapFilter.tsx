import {
  gradientMapTableValues,
  type GradientMapColors,
  type GradientMapStops,
} from "@/lib/gradient-map";

export function GradientMapFilter({
  active,
  colors,
}: {
  active: boolean;
  colors: GradientMapColors & GradientMapStops;
}) {
  if (!active) return null;
  const table = gradientMapTableValues(colors);

  return (
    <svg
      className="gradient-map-filter-definitions"
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
    >
      <filter id="theia-gradient-map-filter" colorInterpolationFilters="sRGB">
        <feColorMatrix type="saturate" values="0" />
        <feComponentTransfer>
          <feFuncR type="table" tableValues={table.red} />
          <feFuncG type="table" tableValues={table.green} />
          <feFuncB type="table" tableValues={table.blue} />
        </feComponentTransfer>
      </filter>
    </svg>
  );
}
