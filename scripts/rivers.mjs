import { Course } from '../public/shared/course.js';
import { LEVELS } from '../public/shared/levels.js';

for (const def of LEVELS) {
  const c = new Course(def);
  const pts = c.points;
  let minW = Infinity, maxW = 0, maxTurn = 0, left = 0, right = 0;
  for (let i = 0; i < pts.length; i++) { minW = Math.min(minW, pts[i].w); maxW = Math.max(maxW, pts[i].w); }
  let prev = null;
  for (let i = 1; i < pts.length; i++) {
    const a = Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x);
    if (prev !== null) {
      let d = Math.atan2(Math.sin(a - prev), Math.cos(a - prev));
      maxTurn = Math.max(maxTurn, Math.abs(d));
      if (d > 0) right += d; else left -= d;
    }
    prev = a;
  }
  let overlaps = 0, closest = Infinity;
  for (let i = 0; i < pts.length; i++) for (let j = i + 16; j < pts.length; j++) {
    const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) - pts[i].w - pts[j].w;
    closest = Math.min(closest, d);
    if (d < 40) overlaps++;
  }
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  console.log(`${def.name.padEnd(22)} len=${c.length} width ${Math.round(minW * 2)}-${Math.round(maxW * 2)} maxTurn/step=${(maxTurn * 57.3).toFixed(1)}deg turned L${(left * 57.3).toFixed(0)} R${(right * 57.3).toFixed(0)} bbox ${Math.round(Math.max(...xs) - Math.min(...xs))}x${Math.round(Math.max(...ys) - Math.min(...ys))} overlaps=${overlaps} closestGap=${closest.toFixed(0)}`);
  console.log(`   rocks ${c.rocks.length} urchins ${c.spikeFields.length} logs ${c.logs.length} rollers ${c.rollers.length} whirlpools ${c.whirlpools.length} falls ${c.falls.length} walls ${c.walls.length} currents ${c.currents.length}`);
}
