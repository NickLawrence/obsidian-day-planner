export const activityColorVariants = [
  "lighter",
  "light",
  "default",
  "dark",
  "darker",
] as const;

export type ActivityColorVariant = (typeof activityColorVariants)[number];
