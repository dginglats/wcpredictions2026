import type { CSSProperties, ReactElement } from "react";

/** Бренды, для которых есть нарисованная эмблема. */
export const CARS_WITH_EMBLEM = ["TOYOTA", "AUDI", "VOLVO", "BMW", "ŠKODA"] as const;

/**
 * Стилизованные монохромные эмблемы автомобилей в координатной сетке 24×24.
 * Рисуются цветом `color` — чтобы совпадать с линией игрока на графике.
 */
function emblemShapes(brand: string, color: string): ReactElement {
  const sw = 1.7;
  switch (brand.toUpperCase()) {
    case "AUDI":
      // Четыре кольца.
      return (
        <g fill="none" stroke={color} strokeWidth={sw}>
          {[5, 9.7, 14.3, 19].map((cx, i) => (
            <circle key={i} cx={cx} cy={12} r={3.4} />
          ))}
        </g>
      );
    case "BMW":
      // Кольцо с двумя закрашенными «четвертинками».
      return (
        <g>
          <circle cx={12} cy={12} r={10} fill="none" stroke={color} strokeWidth={sw} />
          <circle cx={12} cy={12} r={7.4} fill="none" stroke={color} strokeWidth={1} />
          <path d="M12 12 L12 4.6 A7.4 7.4 0 0 1 19.4 12 Z" fill={color} />
          <path d="M12 12 L12 19.4 A7.4 7.4 0 0 1 4.6 12 Z" fill={color} />
        </g>
      );
    case "TOYOTA":
      // Три перекрывающихся эллипса.
      return (
        <g fill="none" stroke={color} strokeWidth={sw}>
          <ellipse cx={12} cy={12} rx={10.5} ry={6.6} />
          <ellipse cx={12} cy={9.4} rx={3} ry={4} />
          <ellipse cx={12} cy={13} rx={6.8} ry={3} />
        </g>
      );
    case "VOLVO":
      // Круг со стрелкой вверх-вправо («железо»).
      return (
        <g fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <circle cx={11} cy={13} r={7.3} />
          <path d="M16.3 7.7 L21 3" />
          <path d="M16.6 3 L21 3 L21 7.4" />
        </g>
      );
    case "ŠKODA":
      // Круг с крылатой стрелой.
      return (
        <g fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <circle cx={12} cy={12} r={9.2} />
          <circle cx={12} cy={12} r={1.7} fill={color} stroke="none" />
          <path d="M12 12 L20.5 9.3" />
          <path d="M18.4 7.3 L21 9 L18.4 11" />
          <path d="M9 6.6 L11.4 10.8" />
          <path d="M6.7 13.2 L11.4 12.3" />
        </g>
      );
    default:
      // Машина не выбрана — простая точка.
      return <circle cx={12} cy={12} r={5} fill={color} />;
  }
}

/** Отдельная эмблема как самостоятельный <svg> (для переиспользования вне графика). */
export function CarEmblem({
  brand,
  color,
  size = 22,
  style,
}: {
  brand?: string | null;
  color: string;
  size?: number;
  style?: CSSProperties;
}): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style}>
      {emblemShapes(brand ?? "", color)}
    </svg>
  );
}

/**
 * Группа <g> с эмблемой для вставки в чужой SVG (например, точка линии Recharts).
 * Центрируется в (cx, cy); под эмблемой — лёгкая тёмная подложка для контраста.
 */
export function carEmblemDot(
  brand: string | null | undefined,
  color: string,
  cx: number,
  cy: number,
  size: number,
  key?: string | number,
): ReactElement {
  return (
    <g key={key} transform={`translate(${cx - size / 2}, ${cy - size / 2}) scale(${size / 24})`}>
      <circle cx={12} cy={12} r={12.5} fill="rgba(2,6,23,0.72)" />
      {emblemShapes(brand ?? "", color)}
    </g>
  );
}
