import type Fraction from "fraction.js";

export interface Overlap {
  columns: number;
  span: number;
  start: number;
  fraction?: Fraction;
}

export function getHorizontalPlacing(overlap?: Overlap) {
  const spanPercent = overlap ? (overlap.span / overlap.columns) * 100 : 100;
  const offsetPercent = overlap ? (100 / overlap.columns) * overlap.start : 0;

  return {
    spanPercent,
    offsetPercent,
  };
}

export type HorizontalPlacing = ReturnType<typeof getHorizontalPlacing>;
