import { useCallback, useRef, useState, type PointerEvent as RPointerEvent, type RefObject } from 'react';

export interface View { x: number; y: number; k: number }
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Déplacement (glisser), zoom (molette / pincement / boutons) pour un SVG. Fonctionne au doigt comme à la souris. */
export function usePanZoom(box: RefObject<HTMLElement | null>) {
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const last = useRef<{ x: number; y: number; dist?: number } | null>(null);
  const moved = useRef(false);

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    setView((v) => { const k = clamp(v.k * factor, 0.1, 3); const r = k / v.k; return { k, x: cx - (cx - v.x) * r, y: cy - (cy - v.y) * r }; });
  }, []);
  const center = () => { const r = box.current?.getBoundingClientRect(); return { cx: (r?.width ?? 800) / 2, cy: (r?.height ?? 600) / 2 }; };

  const fit = useCallback((w: number, h: number) => {
    const r = box.current?.getBoundingClientRect(); if (!r || !w || !h) return;
    const k = clamp(Math.min((r.width - 40) / w, (r.height - 40) / h, 1), 0.1, 1);
    setView({ k, x: (r.width - w * k) / 2, y: (r.height - h * k) / 2 });
  }, [box]);
  const centerOn = useCallback((x: number, y: number) => {
    const r = box.current?.getBoundingClientRect(); if (!r) return;
    setView((v) => ({ ...v, x: r.width / 2 - x * v.k, y: r.height / 2 - y * v.k }));
  }, [box]);

  const handlers = {
    onWheel: (e: React.WheelEvent) => {
      const r = box.current!.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
    },
    onPointerDown: (e: RPointerEvent) => {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      last.current = { x: e.clientX, y: e.clientY }; moved.current = false;
    },
    onPointerMove: (e: RPointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pts = [...pointers.current.values()];
      if (pts.length >= 2) { // pincement
        const d = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
        if (last.current?.dist) { const r = box.current!.getBoundingClientRect(); zoomAt(d / last.current.dist, (pts[0]!.x + pts[1]!.x) / 2 - r.left, (pts[0]!.y + pts[1]!.y) / 2 - r.top); }
        last.current = { x: e.clientX, y: e.clientY, dist: d }; moved.current = true; return;
      }
      const l = last.current; if (!l) return;
      const dx = e.clientX - l.x, dy = e.clientY - l.y;
      if (!moved.current && Math.abs(dx) + Math.abs(dy) > 2) {
        moved.current = true;
        // Le pointeur n'est « capturé » qu'au vrai glissement : un simple clic sur un nœud reste un clic.
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      }
      last.current = { x: e.clientX, y: e.clientY };
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    },
    onPointerUp: (e: RPointerEvent) => { pointers.current.delete(e.pointerId); last.current = pointers.current.size ? last.current : null; if (pointers.current.size < 2 && last.current) last.current.dist = undefined; },
    onPointerCancel: (e: RPointerEvent) => { pointers.current.delete(e.pointerId); last.current = null; },
  };
  return {
    view, setView, handlers, fit, centerOn, wasDrag: () => moved.current,
    zoomIn: () => { const c = center(); zoomAt(1.25, c.cx, c.cy); }, zoomOut: () => { const c = center(); zoomAt(0.8, c.cx, c.cy); },
  };
}
