export const dailySlotMs = 24 * 3600_000;
const anchor = (16 * 60 + 1) * 60_000;

export const slotAt = (now = Date.now()) => Math.floor((now - anchor) / dailySlotMs) * dailySlotMs + anchor;

export function timerBelongsToSlot(triggeredAt, slot, now = Date.now()) {
  return Number.isFinite(triggeredAt) && triggeredAt <= now && String(slotAt(triggeredAt)) === String(slot);
}
