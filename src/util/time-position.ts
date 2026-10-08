import type { Moment } from "moment";

export function getMinutesSinceMidnight(time: Moment) {
  return time.diff(time.clone().startOf("day"), "minutes");
}

export function getEndMinutes(task: {
  startTime: Moment;
  durationMinutes: number;
}) {
  return getMinutesSinceMidnight(task.startTime) + task.durationMinutes;
}
