// Modified for Studio 4000: keep marquee selection moving beyond the viewport.
export function edgeVelocity(pointer: number, start: number, end: number, edge = 40) {
  const zone = Math.min(edge, Math.max(1, (end - start) / 2));
  if (pointer < start + zone) return -900 * Math.min(1, (start + zone - pointer) / zone);
  if (pointer > end - zone) return 900 * Math.min(1, (pointer - end + zone) / zone);
  return 0;
}

/** Scrolls on animation frames, including when the held pointer is stationary at an edge. */
export function startSelectionDrag(
  down: PointerEvent,
  host: HTMLElement,
  headerWidth: () => number,
  onMove: (dx: number, dy: number, event: PointerEvent) => void,
  onEnd: (event: PointerEvent, cancelled: boolean) => void,
) {
  down.preventDefault();
  let latest = down, active = false, pending = false, stopped = false;
  let previous = performance.now(), frame = 0;
  const move = (event: PointerEvent) => {
    if (event.pointerId !== down.pointerId) return;
    latest = event;
    pending = true;
    active ||= Math.abs(event.clientX - down.clientX) + Math.abs(event.clientY - down.clientY) >= 4;
  };
  const finish = (event: PointerEvent, cancelled: boolean) => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("blur", blur);
    if (!cancelled && active) onMove(event.clientX - down.clientX, event.clientY - down.clientY, event);
    onEnd(event, cancelled);
  };
  const up = (event: PointerEvent) => { if (event.pointerId === down.pointerId) finish(event, false); };
  const cancel = (event: PointerEvent) => { if (event.pointerId === down.pointerId) finish(event, true); };
  const blur = () => finish(latest, true);
  const tick = (now: number) => {
    if (stopped) return;
    const seconds = Math.min(0.05, Math.max(0, now - previous) / 1000);
    previous = now;
    if (active) {
      const rect = host.getBoundingClientRect();
      const left = host.scrollLeft, top = host.scrollTop;
      host.scrollLeft = Math.max(0, Math.min(host.scrollWidth - host.clientWidth,
        left + edgeVelocity(latest.clientX, rect.left + headerWidth(), rect.left + host.clientWidth) * seconds));
      host.scrollTop = Math.max(0, Math.min(host.scrollHeight - host.clientHeight,
        top + edgeVelocity(latest.clientY, rect.top + 34, rect.top + host.clientHeight) * seconds));
      if (pending || host.scrollLeft !== left || host.scrollTop !== top)
        onMove(latest.clientX - down.clientX, latest.clientY - down.clientY, latest);
    }
    pending = false;
    frame = requestAnimationFrame(tick);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("blur", blur);
  frame = requestAnimationFrame(tick);
  return () => finish(latest, true);
}
