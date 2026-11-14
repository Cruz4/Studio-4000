// Effect editors coalesce pointer movement into asynchronous engine writes. History
// actions wait for those writes so a late drag value cannot erase the redo stack.
const activity = new Set<() => boolean>();

export function registerEffectActivity(check: () => boolean) {
  activity.add(check);
  return () => { activity.delete(check); };
}

export async function settleEffectWrites(timeoutMs = 1500) {
  const end = performance.now() + timeoutMs;
  let quietFrames = 0;
  while (performance.now() < end) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if ([...activity].some((check) => check())) quietFrames = 0;
    else if (++quietFrames >= 2) return;
  }
}
