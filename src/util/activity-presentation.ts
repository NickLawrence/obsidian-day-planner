const qualityEmojiByScore = [
  "😭",
  "😢",
  "🙁",
  "😟",
  "😕",
  "😐",
  "🙂",
  "😊",
  "😄",
  "😁",
  "🤩",
];

export function getActivityQualityLabel(quality?: number) {
  if (typeof quality !== "number") return undefined;
  const index = Math.min(10, Math.max(0, Math.round(quality)));
  return `${quality} ${qualityEmojiByScore[index]}`;
}
