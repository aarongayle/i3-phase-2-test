/**
 * Sparkline SVG component for inline trend visualization
 */
export default function Sparkline({
  values,
  width = 120,
  height = 28,
  className = "",
}) {
  const series = (values || []).map((v) =>
    Number.isFinite(v) ? v : Number(v) || 0
  );
  const n = series.length;
  const w = Math.max(10, Number(width) || 120);
  const h = Math.max(10, Number(height) || 28);

  if (n === 0) {
    return (
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        className={className || "text-gray-300"}
      ></svg>
    );
  }

  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min;
  const pad = 1;
  const innerH = h - pad * 2;
  const innerW = w - pad * 2;
  const stepX = n > 1 ? innerW / (n - 1) : 0;

  const yFor = (v) => {
    if (range === 0) return pad + innerH / 2;
    const t = (v - min) / range;
    return pad + (1 - t) * innerH;
  };

  const points = series.map((v, i) => [pad + i * stepX, yFor(v)]);
  const path = points
    .map(
      ([x, y], i) =>
        `${i === 0 ? "M" : "L"}${Math.round(x * 100) / 100} ${
          Math.round(y * 100) / 100
        }`
    )
    .join(" ");

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className={className || "text-blue-600"}
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
