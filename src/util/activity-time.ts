import moment from "moment";

import { clockFormat } from "../constants";

export function formatActivityTimestamp(
  timestamp: number | string = Date.now(),
) {
  return typeof timestamp === "string"
    ? timestamp
    : moment(timestamp).format(clockFormat);
}

export function parseActivityTimestamp(timestamp: string) {
  // Moment's browser ESM build exposes ISO_8601 on its default export.
  // eslint-disable-next-line import/no-named-as-default-member
  return moment(timestamp, moment.ISO_8601, true);
}
