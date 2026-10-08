import Fraction from "fraction.js";
import { partition } from "lodash/fp";
import type { Moment } from "moment";
import { isNotVoid } from "typed-assert";

import { getMinutesSinceMidnight, getEndMinutes } from "../util/time-position";

import type { Overlap, HorizontalPlacing } from "./horizontal-placing";
import { getHorizontalPlacing } from "./horizontal-placing";

const empty = "empty";
const taken = "taken";

interface TimedBlock {
  id: string;
  startTime: Moment;
  durationMinutes: number;
}

export function computeOverlap(items: Array<TimedBlock>): Map<string, Overlap> {
  return items.reduce((overlapLookup, item) => {
    const overlapGroup = getItemsOverlappingItemAndEachOther(item, items);

    return computeOverlapForGroup(overlapGroup, overlapLookup);
  }, new Map());
}

function getItemsOverlappingItemAndEachOther(
  item: TimedBlock,
  items: Array<TimedBlock>,
) {
  return items
    .reduce(
      (result, current) => {
        if (current === item) {
          return result;
        }

        const currentOverlapsWithPreviousItems = result.every(
          (intersectingItem) => overlaps(intersectingItem, current),
        );

        if (currentOverlapsWithPreviousItems) {
          result.push(current);
        }

        return result;
      },
      [item],
    )
    .sort((a, b) => a.startTime.diff(b.startTime));
}

function computeOverlapForGroup(
  overlapGroup: Array<TimedBlock>,
  previousLookup: Map<string, Overlap>,
) {
  const newLookup = new Map([...previousLookup]);

  const [itemsPlacedPreviously, itemsToBePlaced] = partition(
    ({ id }) => newLookup.has(id),
    overlapGroup,
  );

  if (itemsToBePlaced.length === 0) {
    return newLookup;
  }

  const fractionOfPlacedItems = itemsPlacedPreviously.reduce((sum, current) => {
    const placing = newLookup.get(current.id);

    isNotVoid(placing);

    return new Fraction(placing.span, placing.columns).add(sum);
  }, new Fraction(0));

  const fractionForNewItems = new Fraction(1).sub(fractionOfPlacedItems);
  const fractionForEachNewItem = fractionForNewItems.div(
    itemsToBePlaced.length,
  );

  const columnsForNewGroup = fractionForEachNewItem.d;
  const newItemInherentSpan = fractionForEachNewItem.n;

  const slots = Array(columnsForNewGroup).fill(empty);

  itemsPlacedPreviously.forEach((item) => {
    const placing = newLookup.get(item.id);

    isNotVoid(placing);

    const { start, span, columns: previousColumns } = placing;

    const scale = columnsForNewGroup / previousColumns;
    const scaledStart = scale * start;
    const scaledSpan = scale * span;
    const scaledEnd = scaledStart + scaledSpan;

    slots.fill(taken, scaledStart, scaledEnd);
  });

  itemsToBePlaced.forEach((itemInGroup) => {
    const firstFreeSlotIndex = slots.findIndex((slot) => slot === empty);
    const nextTakenSlotIndex = slots.findIndex(
      (slot, i) => i > firstFreeSlotIndex && slot === taken,
    );

    const fromFreeToNextTakenSlot = nextTakenSlotIndex - firstFreeSlotIndex;
    const onlyEmptySlotsLeft = nextTakenSlotIndex === -1;

    const span = onlyEmptySlotsLeft
      ? newItemInherentSpan
      : Math.min(newItemInherentSpan, fromFreeToNextTakenSlot);

    const fillEnd = firstFreeSlotIndex + span;

    slots.fill(taken, firstFreeSlotIndex, fillEnd);

    newLookup.set(itemInGroup.id, {
      start: firstFreeSlotIndex,
      span,
      columns: columnsForNewGroup,
    });
  });

  return newLookup;
}

function overlaps(a: TimedBlock, b: TimedBlock) {
  const [early, late] =
    getMinutesSinceMidnight(a.startTime) < getMinutesSinceMidnight(b.startTime)
      ? [a, b]
      : [b, a];

  return getEndMinutes(early) > getMinutesSinceMidnight(late.startTime);
}

export function addHorizontalPlacing<T extends TimedBlock>(
  blocks: Array<T>,
): Array<T & { placing: HorizontalPlacing }> {
  if (blocks.length === 0) {
    return [];
  }

  const overlapLookup = computeOverlap(blocks);

  return blocks.map((task) => {
    const overlap = overlapLookup.get(task.id);

    return {
      ...task,
      placing: getHorizontalPlacing(overlap),
    };
  });
}
