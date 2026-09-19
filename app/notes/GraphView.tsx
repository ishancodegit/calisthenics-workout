"use client";

import { useEffect, useRef } from "react";

export type GraphNode = { id: string; title: string; links: string[]; tags: string[] };

type Sim = { id: string; title: string; x: number; y: number; vx: number; vy: number; deg: number };

/**
 * Link graph, Obsidian style. Plain canvas + a small spring simulation —
 * no library, and it stops simulating once things settle so an iPad's
 * battery survives having it open.
 */
export default function GraphView({
  nodes,
  currentId,
  onOpen,
}: {
  nodes: GraphNode[];
  currentId: string | null;
  onOpen: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<{ nodes: Sim[]; edges: [number, number][] } | null>(null);
  const viewRef = useRef({ x: 0, y: 0, k: 1 });
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => {
    const index = new Map(nodes.map((n, i) => [n.id, i]));
    const edges: [number, number][] = [];
    const deg = new Array(nodes.length).fill(0);
    nodes.forEach((n, i) => {
      for (const l of n.links) {
        const j = index.get(l);
        if (j !== undefined && j !== i) {
          edges.push([i, j]);
          deg[i]++;
          deg[j]++;
        }
      }
    });
    const radius = Math.min(260, 40 + nodes.length * 6);
    simRef.current = {
      nodes: nodes.map((n, i) => ({
        id: n.id,
        title: n.title,
        x: Math.cos((i / Math.max(1, nodes.length)) * Math.PI * 2) * radius + (Math.random() - 0.5) * 20,
        y: Math.sin((i / Math.max(1, nodes.length)) * Math.PI * 2) * radius + (Math.random() - 0.5) * 20,
        vx: 0,
        vy: 0,
        deg: deg[i],
      })),
      edges,
    };
  }, [nodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    let alpha = 1;

    const tick = () => {
      const sim = simRef.current;
      const ctx = canvas.getContext("2d");
      if (!sim || !ctx) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }

      if (alpha > 0.005) {
        const ns = sim.nodes;
        for (let i = 0; i < ns.length; i++) {
          for (let j = i + 1; j < ns.length; j++) {
            let dx = ns[j].x - ns[i].x;
            let dy = ns[j].y - ns[i].y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 1) {
              dx = Math.random() - 0.5;
              dy = Math.random() - 0.5;
              d2 = 1;
            }
            const f = (900 * alpha) / d2;
            const d = Math.sqrt(d2);
            ns[i].vx -= (dx / d) * f;
            ns[i].vy -= (dy / d) * f;
            ns[j].vx += (dx / d) * f;
            ns[j].vy += (dy / d) * f;
          }
        }
        for (const [a, b] of sim.edges) {
          const dx = ns[b].x - ns[a].x;
          const dy = ns[b].y - ns[a].y;
          const d = Math.hypot(dx, dy) || 1;
          const f = (d - 70) * 0.012 * alpha;
          ns[a].vx += (dx / d) * f;
          ns[a].vy += (dy / d) * f;
          ns[b].vx -= (dx / d) * f;
          ns[b].vy -= (dy / d) * f;
        }
        let cx = 0;
        let cy = 0;
        for (const n of ns) {
          n.vx -= n.x * 0.01 * alpha;
          n.vy -= n.y * 0.01 * alpha;
          n.vx *= 0.82;
          n.vy *= 0.82;
          n.x += n.vx;
          n.y += n.vy;
          cx += n.x;
          cy += n.y;
        }
        // Recentre on the centroid so the cluster never drifts off-screen.
        cx /= ns.length || 1;
        cy /= ns.length || 1;
        for (const n of ns) {
          n.x -= cx;
          n.y -= cy;
        }
        alpha *= 0.985;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const view = viewRef.current;
      ctx.translate(w / 2 + view.x, h / 2 + view.y);
      ctx.scale(view.k, view.k);

      ctx.strokeStyle = "rgba(255,255,255,0.13)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const [a, b] of sim.edges) {
        ctx.moveTo(sim.nodes[a].x, sim.nodes[a].y);
        ctx.lineTo(sim.nodes[b].x, sim.nodes[b].y);
      }
      ctx.stroke();

      for (const n of sim.nodes) {
        const active = n.id === currentId;
        const r = 4 + Math.min(9, n.deg * 1.4);
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = active ? "#f5e000" : n.deg ? "#8a8a8a" : "#4a4a4a";
        ctx.fill();
        if (view.k > 0.55 || active) {
          ctx.fillStyle = active ? "#f5e000" : "rgba(255,255,255,0.55)";
          ctx.font = `${active ? 700 : 400} 11px ui-sans-serif, system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(n.title.slice(0, 22), n.x, n.y + r + 12);
        }
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [currentId]);

  const pick = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const sim = simRef.current;
    if (!canvas || !sim) return null;
    const rect = canvas.getBoundingClientRect();
    const view = viewRef.current;
    const x = (clientX - rect.left - rect.width / 2 - view.x) / view.k;
    const y = (clientY - rect.top - rect.height / 2 - view.y) / view.k;
    let best: Sim | null = null;
    let bestD = 18;
    for (const n of sim.nodes) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  };

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full touch-none"
      onPointerDown={(e) => {
        dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
        (e.target as Element).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = dragRef.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
        viewRef.current.x += dx;
        viewRef.current.y += dy;
        d.x = e.clientX;
        d.y = e.clientY;
      }}
      onPointerUp={(e) => {
        const d = dragRef.current;
        dragRef.current = null;
        if (d && !d.moved) {
          const hit = pick(e.clientX, e.clientY);
          if (hit) onOpen(hit.id);
        }
      }}
      onWheel={(e) => {
        const view = viewRef.current;
        view.k = Math.max(0.25, Math.min(3, view.k * (e.deltaY < 0 ? 1.12 : 0.89)));
      }}
    />
  );
}
