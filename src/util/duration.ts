import type { Duration } from "moment";

/** Formats a duration as compact hours and minutes for display in the UI. */
export function formatDuration(duration: Duration) {
  const totalMinutes = Math.round(duration.asMinutes());
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
}
