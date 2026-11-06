const halfDay=12*3600_000, chinaOffset=8*3600_000, anchor=(4*60+1)*60_000;
export const slotAt = (now=Date.now()) => Math.floor((now-anchor)/halfDay)*halfDay+anchor;
export const timerBelongsToSlot = (triggeredAt, slot, now=Date.now()) => Number.isFinite(triggeredAt) && triggeredAt<=now && String(slotAt(triggeredAt))===String(slot);
export const chinaDay = time => new Date(time+chinaOffset).toISOString().slice(0,10);
export const isNoonSlot = slot => new Date(Number(slot)+chinaOffset).getUTCHours()===12;

/** Only completed real timer days qualify; simulated/manual records never advance cadence. */
export function stableThreeDays(records, now, sourceIds, recovery) {
  const todayStart=Date.parse(chinaDay(now)+'T00:00:00+08:00');
  const days=[3,2,1].map(n=>chinaDay(todayStart-n*24*3600_000));
  if(sourceIds.length!==36||new Set(sourceIds).size!==36||recovery?.kind!=='live' ||
      !Number.isFinite(Date.parse(recovery.verifiedAt)) || Date.parse(recovery.verifiedAt)>now ||
      !['wake','interruptedCommit','failedSourceKeepsLastGood','failedInstallKeepsLastGood','webRestart'].every(key=>recovery.checks?.[key]===true))return null;
  for(const day of days) {
    for(const clock of ['00:01:00','12:01:00']) {
      const slot=Date.parse(`${day}T${clock}+08:00`);
      if(!records.some(row=>Number(row.slot)===slot && row.kind==='live' && row.trigger==='timer' &&
          Number.isFinite(Date.parse(row.verifiedAt)) && Date.parse(row.verifiedAt)>=slot && chinaDay(Date.parse(row.verifiedAt))===day &&
          row.complete===true && row.quarantinedJobCount===0 && row.webReadback===true && row.capturedSourceIds?.length===36 &&
          new Set(row.capturedSourceIds).size===36 && sourceIds.every(id=>row.capturedSourceIds.includes(id))))return null;
    }
  }
  return days;
}
