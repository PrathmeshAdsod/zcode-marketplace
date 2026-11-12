import { useEffect, useRef } from 'react';

const mouseMotion = '(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)';
const nativeTargets = 'input, textarea, select, [contenteditable], code, pre, iframe, video, [data-native-cursor]';

export function MagneticCursor() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const cursor = ref.current;
    if (!cursor) return;
    const media = window.matchMedia(mouseMotion);
    let frame = 0, x = 0, y = 0, targetX = 0, targetY = 0, visible = false;
    function reset() {
      cancelAnimationFrame(frame);
      frame = 0;
      visible = false;
      document.documentElement.removeAttribute('data-round-cursor');
      cursor!.removeAttribute('data-active');
      cursor!.removeAttribute('data-stick');
    }
    function render() {
      const dx = targetX - x, dy = targetY - y;
      x += dx * .28;
      y += dy * .28;
      cursor!.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
      frame = Math.abs(dx) + Math.abs(dy) > .3 ? requestAnimationFrame(render) : 0;
    }
    function move(event: PointerEvent) {
      if (!media.matches || event.pointerType !== 'mouse' || !(event.target instanceof Element) || event.target.closest(nativeTargets)) {
        reset();
        return;
      }
      const link = event.target.closest('a, button, summary, [role="button"]');
      const bounds = link?.getBoundingClientRect();
      const pull = (offset: number) => Math.min(8, Math.max(-8, offset * .13));
      targetX = event.clientX + (bounds ? pull(bounds.left + bounds.width / 2 - event.clientX) : 0);
      targetY = event.clientY + (bounds ? pull(bounds.top + bounds.height / 2 - event.clientY) : 0);
      if (!visible) { x = targetX; y = targetY; visible = true; }
      cursor!.toggleAttribute('data-stick', Boolean(link));
      cursor!.setAttribute('data-active', '');
      document.documentElement.setAttribute('data-round-cursor', '');
      if (!frame) frame = requestAnimationFrame(render);
    }
    window.addEventListener('pointermove', move, { passive: true });
    document.documentElement.addEventListener('pointerleave', reset);
    window.addEventListener('blur', reset);
    window.addEventListener('keydown', reset);
    media.addEventListener('change', reset);
    return () => {
      reset();
      window.removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', reset);
      window.removeEventListener('blur', reset);
      window.removeEventListener('keydown', reset);
      media.removeEventListener('change', reset);
    };
  }, []);
  return <div ref={ref} aria-hidden="true" className="magnetic-cursor"><span/></div>;
}
