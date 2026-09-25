/**
 * Frame selection for triage: the frames nearest the break, at most six, in time order
 * (ADR M07-budgets). Only frames whose image the caller supplied can be sent.
 */
import type { BreakFrame } from '@argus/contracts';

/** Distance to the break; at equal distance a frame before the break comes first. */
function nearness(a: BreakFrame, b: BreakFrame): number {
  const distance = Math.abs(a.tMs) - Math.abs(b.tMs);
  if (distance !== 0) return distance;
  return a.tMs - b.tMs;
}

/**
 * Up to `max` frames with an image, nearest the break first, returned in time order
 * (ties keep packet order). Fewer than `max` only when fewer have images.
 */
export function selectFrames(
  frames: readonly BreakFrame[],
  hasImage: (ref: string) => boolean,
  max: number,
): BreakFrame[] {
  const seen = new Set<string>();
  const usable = frames
    .map((frame, index) => ({ frame, index }))
    .filter(({ frame }) => {
      if (seen.has(frame.ref) || !hasImage(frame.ref)) return false;
      seen.add(frame.ref);
      return true;
    });
  const chosen = [...usable]
    .sort((a, b) => nearness(a.frame, b.frame) || a.index - b.index)
    .slice(0, Math.max(0, max));
  return chosen
    .sort((a, b) => a.frame.tMs - b.frame.tMs || a.index - b.index)
    .map(({ frame }) => frame);
}

/**
 * Frames dropped one by one for the budget: the farthest from the break first, never
 * below `min`. Returns the order in which frames of `selected` would be dropped.
 */
export function frameDropOrder(selected: readonly BreakFrame[], min: number): BreakFrame[] {
  const droppable = Math.max(0, selected.length - Math.max(0, min));
  return [...selected]
    .map((frame, index) => ({ frame, index }))
    .sort((a, b) => nearness(b.frame, a.frame) || b.index - a.index)
    .slice(0, droppable)
    .map(({ frame }) => frame);
}
