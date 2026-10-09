/** Keep native keyboard controls, but require an intentional thumb drag on touch. */
export function scrollSafeRange(node: HTMLElement) {
  const input = node.querySelector("input")!;
  let gesture:
    | {
        id: number;
        x: number;
        y: number;
        value: string;
        touch: boolean;
        dragging: boolean;
        width: number;
        left: number;
      }
    | undefined;

  function update(value: number) {
    const min = Number(input.min);
    const max = Number(input.max);
    const step = Number(input.step) || 1;
    input.value = String(
      Math.max(
        min,
        Math.min(max, min + Math.round((value - min) / step) * step),
      ),
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function down(event: PointerEvent) {
    if (gesture || !event.isPrimary || event.button !== 0) return;
    const rect = input.getBoundingClientRect();
    const width = Math.max(1, rect.width - 16);
    const left = rect.left + 8;
    const touch = event.pointerType !== "mouse";
    const thumbX =
      left +
      ((Number(input.value) - Number(input.min)) /
        (Number(input.max) - Number(input.min))) *
        width;
    // Touching the track should scroll, never jump the value.
    if (touch && Math.abs(event.clientX - thumbX) > 24) return;
    gesture = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      value: input.value,
      touch,
      dragging: !touch,
      width,
      left,
    };
    node.setPointerCapture(event.pointerId);
    if (!touch) {
      event.preventDefault();
      input.focus();
      move(event);
    }
  }

  function move(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.id) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.dragging) {
      if (Math.abs(dy) >= 8 && Math.abs(dy) >= Math.abs(dx)) {
        finish(event, true);
        return;
      }
      if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) return;
      gesture.dragging = true;
    }
    const range = Number(input.max) - Number(input.min);
    update(
      gesture.touch
        ? Number(gesture.value) + (dx / gesture.width) * range
        : Number(input.min) +
            ((event.clientX - gesture.left) / gesture.width) * range,
    );
  }

  function finish(event: PointerEvent, cancelled = false) {
    if (!gesture || event.pointerId !== gesture.id) return;
    const previous = gesture;
    gesture = undefined;
    if (cancelled && input.value !== previous.value) {
      input.value = previous.value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    } else if (
      !cancelled &&
      previous.dragging &&
      input.value !== previous.value
    ) {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (node.hasPointerCapture(event.pointerId))
      node.releasePointerCapture(event.pointerId);
  }

  const up = (event: PointerEvent) => finish(event);
  const cancel = (event: PointerEvent) => finish(event, true);
  node.addEventListener("pointerdown", down);
  node.addEventListener("pointermove", move);
  node.addEventListener("pointerup", up);
  node.addEventListener("pointercancel", cancel);
  node.addEventListener("lostpointercapture", cancel);
  return {
    destroy() {
      node.removeEventListener("pointerdown", down);
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", cancel);
      node.removeEventListener("lostpointercapture", cancel);
    },
  };
}
