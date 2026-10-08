import chroma from "chroma-js";
import type { HexString } from "obsidian";

import { type ActivityColorVariant } from "./activity-colors";
export { activityColorVariants } from "./activity-colors";
export type { ActivityColorVariant } from "./activity-colors";

const activityColorVariantBrightness: Record<ActivityColorVariant, number> = {
  lighter: 2,
  light: 1,
  default: 0,
  dark: -1,
  darker: -2,
};

export function applyActivityColorVariant(
  color: string,
  variant: ActivityColorVariant = "default",
) {
  return chroma(color).brighten(activityColorVariantBrightness[variant]).hex();
}

export interface ContrastColors {
  normal: HexString;
  muted: HexString;
  faint: HexString;
}

// just using values from the default themes to get good gradients for light and dark colors
const lightThemeColors: ContrastColors = {
  normal: "#222222",
  muted: "#5c5c5c",
  faint: "#666666",
};

const darkThemeColors: ContrastColors = {
  normal: "#dadada",
  muted: "#b3b3b3",
  faint: "#ababab",
};

export function getTextColorWithEnoughContrast(
  backgroundColor: HexString,
): ContrastColors {
  return chroma.contrast(backgroundColor, darkThemeColors.normal) >
    chroma.contrast(backgroundColor, lightThemeColors.normal)
    ? darkThemeColors
    : lightThemeColors;
}
