import { afterEach, describe, expect, it, vi } from "vitest";

import { scrollSafeRange } from "../src/ui/scroll-safe-range";

afterEach(() => document.body.replaceChildren());

function setup() {
  const node = document.createElement("div");
  node.innerHTML = '<input type="range" min="0" max="10" step="1" value="5">';
  document.body.append(node);
  const input = node.querySelector("input")!;
  input.getBoundingClientRect = () => ({ left: 0, width: 116 }) as DOMRect;
  node.setPointerCapture = vi.fn();
  node.hasPointerCapture = () => true;
  node.releasePointerCapture = vi.fn();
  const change = vi.fn();
  input.addEventListener("change", change);
  const action = scrollSafeRange(node);
  function pointer(type: string, x: number, y = 0, pointerType = "touch") {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, {
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: x,
      clientY: y,
      pointerType,
    });
    node.dispatchEvent(event);
  }
  return { input, change, pointer, action };
}

describe("scroll-safe goal slider", () => {
  it("does not change or save when scrolling from the thumb", () => {
    const { input, change, pointer } = setup();
    pointer("pointerdown", 58);
    pointer("pointermove", 60, 25);
    pointer("pointerup", 60, 25);
    expect(input.value).toBe("5");
    expect(change).not.toHaveBeenCalled();
  });

  it("ignores track touches and taps on the thumb", () => {
    const { input, change, pointer } = setup();
    pointer("pointerdown", 100);
    pointer("pointermove", 110);
    pointer("pointerup", 110);
    pointer("pointerdown", 58);
    pointer("pointerup", 58);
    expect(input.value).toBe("5");
    expect(change).not.toHaveBeenCalled();
  });

  it("previews a horizontal thumb drag and saves once on release", () => {
    const { input, change, pointer } = setup();
    pointer("pointerdown", 58);
    pointer("pointermove", 62, 1);
    expect(input.value).toBe("5");
    pointer("pointermove", 88, 2);
    expect(input.value).toBe("8");
    expect(change).not.toHaveBeenCalled();
    pointer("pointerup", 88, 2);
    expect(change).toHaveBeenCalledOnce();
  });

  it("restores the initial value without saving after browser cancellation", () => {
    const { input, change, pointer } = setup();
    const preview = vi.fn();
    input.addEventListener("input", preview);
    pointer("pointerdown", 58);
    pointer("pointermove", 88);
    pointer("pointercancel", 88);
    expect(input.value).toBe("5");
    expect(preview).toHaveBeenCalledTimes(2);
    expect(change).not.toHaveBeenCalled();
  });

  it("allows mouse track clicks and clamps dragging to the range", () => {
    const { input, change, pointer } = setup();
    pointer("pointerdown", 88, 0, "mouse");
    expect(input.value).toBe("8");
    pointer("pointermove", 200, 0, "mouse");
    expect(input.value).toBe("10");
    pointer("pointerup", 200, 0, "mouse");
    expect(change).toHaveBeenCalledOnce();
  });

  it("removes pointer listeners when unmounted", () => {
    const { input, change, pointer, action } = setup();
    action.destroy();
    pointer("pointerdown", 88, 0, "mouse");
    pointer("pointerup", 88, 0, "mouse");
    expect(input.value).toBe("5");
    expect(change).not.toHaveBeenCalled();
  });
});
