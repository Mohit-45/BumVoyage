// Runs the autopilot on every river with 1 to 4 crew members and checks the difficulty targets:
//   level 1: all four crew sizes finish with at most 2 sinks
//   every other level: at least 2 of the 4 crew sizes finish inside the time limit
//   node scripts/tune.mjs [maxSeconds=600]
import { Course } from '../public/shared/course.js';
import { LEVELS } from '../public/shared/levels.js';
import { Simulation } from '../server/Simulation.js';
import { runAutopilot } from '../test/autopilot.js';

const maxSeconds = Number(process.argv[2]) || 600;
const problems = [];

LEVELS.forEach((def, index) => {
  const course = new Course(def);
  const line = [`${def.name.padEnd(22)} par=${String(course.parTime).padStart(3)}s`];
  const results = [1, 2, 3, 4].map((seats) => runAutopilot(new Simulation(course, seats), maxSeconds));
  results.forEach((r, k) => line.push(`${k + 1}p:${r.finished ? 'ok ' : 'DNF'} ${r.time.toFixed(0).padStart(3)}s sk${r.sinks} b${r.bumps}`));
  console.log(line.join(' | '));
  const finished = results.filter((r) => r.finished).length;
  if (index === 0) {
    if (finished < 4) problems.push(`${def.name}: only ${finished}/4 crew sizes finished`);
    results.forEach((r, k) => r.sinks > 2 && problems.push(`${def.name}: ${k + 1} players sank ${r.sinks} times`));
  } else if (finished < 2) {
    problems.push(`${def.name}: only ${finished}/4 crew sizes finished in ${maxSeconds}s`);
  }
});

console.log(problems.length ? `\nTARGETS MISSED:\n  ${problems.join('\n  ')}` : '\nAll difficulty targets met.');
if (problems.length) process.exitCode = 1;
