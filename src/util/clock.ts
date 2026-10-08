import type { Moment } from "moment";

import { defaultDurationMinutes } from "../constants";
import type { LocalTask } from "../task-types";

import { getId } from "./id";

export type ClockMoments = [Moment, Moment];

export function createClockTaskFromActivity(props: {
  activity: {
    title: string;
    location: LocalTask["location"];
  };
  clockMoments: ClockMoments;
  defaultDurationMinutes?: number;
}): LocalTask {
  const {
    activity,
    clockMoments,
    defaultDurationMinutes: durationFallback = defaultDurationMinutes,
  } = props;

  const [startTime, endTime] = clockMoments;
  let durationMinutes = endTime.diff(startTime, "minutes");

  if (durationMinutes < 0) {
    durationMinutes = durationFallback;
  }

  return {
    id: getId(),
    startTime,
    durationMinutes,
    isAllDayEvent: false,
    symbol: "-",
    status: " ",
    text: activity.title,
    lines: [],
    location: activity.location,
  };
}
