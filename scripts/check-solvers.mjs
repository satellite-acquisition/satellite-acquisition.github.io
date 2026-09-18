import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const context = vm.createContext({ window: {} });
vm.runInContext(await readFile(new URL('../console/paper-solvers.js', import.meta.url), 'utf8'),
  context, { filename: 'console/paper-solvers.js', timeout: 1000 });
const solvers = context.LeoptSolvers ?? context.window.LeoptSolvers;
assert(solvers, 'The browser solver library must load without a DOM or network.');

const policies = ['bs_mpc', 'bayes_mpc', 'bayes_greedy', 'frozen_greedy',
  'probability_ordered', 'tube_uniform', 'sky_raster'];
const slow = { maxRate: 1.1, maxAccel: 1, interval: 6, settle: 0.5, dwell: 1.5 };
const fast = { ...slow, maxRate: 100, maxAccel: 100 };
const close = (actual, expected, message, tolerance = 1e-10) =>
  assert(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} != ${expected}`);
const pointDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function problem(stages, candidates, weights, detection) {
  return {
    weights, initial: [0, 0], limits: fast, beamSigma: 0.5, peakProbability: 0.9,
    particles: Array.from({ length: stages }, () => weights.map((_, index) => [index, 0])),
    candidates: Array.from({ length: stages }, () => candidates.map((point) => [...point])),
    ...(detection ? { detection } : {}),
  };
}

function checkSchedule(input, result) {
  assert.equal(result.schedule.length, input.candidates.length, `${result.policy}: preserve the full contact`);
  let previous = input.initial;
  for (const step of result.schedule) {
    assert(step.point.every(Number.isFinite), `${result.policy}: finite pointings`);
    assert(solvers.transitionFeasible(previous, step.point, input.limits), `${result.policy}: feasible transfers`);
    assert(step.posterior.every((weight) => Number.isFinite(weight) && weight >= 0));
    close(step.posterior.reduce((sum, weight) => sum + weight, 0), 1, `${result.policy}: normalized posterior`);
    close(step.cumulativeAcquisition + step.cumulativeFalseConfirmation + step.remainingProbability,
      1, `${result.policy}: first-event mass conservation`);
    previous = step.point;
  }
  assert(Number.isFinite(result.score) && result.score >= 0 && result.score <= 1);
}

// Four seconds of motion includes acceleration and braking, not just a rate cap.
close(solvers.maximumSlewDistance(slow), 3.19, 'Trapezoidal rest-to-rest transfer');
const triangular = { ...slow, maxRate: 10, maxAccel: 2, interval: 3 };
close(solvers.maximumSlewDistance(triangular), 0.5, 'Triangular rest-to-rest transfer');
close(solvers.minimumSlewTime(3.19, slow), 4, 'Inverse rest-to-rest transfer time');
assert(solvers.transitionFeasible([0, 0], [3.19, 0], slow));
assert(!solvers.transitionFeasible([0, 0], [3.2, 0], slow));
assert(!solvers.transitionFeasible([0, 0], [3, 2], slow), 'Feasibility must include both angular dimensions.');
const partial = solvers.moveToward([0, 0], [6, 8], slow);
close(pointDistance([0, 0], partial), 3.19, 'Partial transfer reaches the motion envelope');
close(partial[0] / partial[1], 6 / 8, 'Partial transfer preserves its direction');

const posterior = solvers.posteriorAfterMiss([0.6, 0.4], [0.8, 0.1], [0.05, 0.05]);
close(posterior[0], 0.09 / 0.43, 'Miss likelihood excludes correct and false confirmations');
close(posterior[1], 0.34 / 0.43, 'Miss posterior normalization');
assert.throws(() => solvers.posteriorAfterMiss([1], [1]), /zero probability/i,
  'An impossible miss must not fabricate a posterior.');
assert.throws(() => solvers.posteriorAfterMiss([1], [0.8], [0.3]), /sum to at most one/i,
  'Competing confirmation probabilities cannot exceed one.');

// Two nearby candidates cover the same particle; a miss changes the adaptive ranking.
const overlap = problem(3, [[0, 0], [1, 0], [2, 0]], [0.6, 0.4],
  (_, point, particle) => point[0] === 0 ? (particle === 0 ? 0.9 : 0)
    : point[0] === 1 ? (particle === 0 ? 0.8 : 0) : (particle === 1 ? 0.9 : 0));
const frozen = solvers.compile(overlap, 'frozen_greedy');
const greedy = solvers.compile(overlap, 'bayes_greedy');
const ranked = solvers.compile(overlap, 'probability_ordered');
assert.deepEqual(Array.from(frozen.schedule.slice(0, 2), (step) => step.point[0]), [0, 0],
  'Frozen-prior greedy retains its initial ranking after a miss.');
assert.deepEqual(Array.from(greedy.schedule.slice(0, 2), (step) => step.point[0]), [0, 2],
  'Bayesian greedy should search the other particle after a miss.');
assert.deepEqual(Array.from(ranked.schedule.slice(0, 2), (step) => step.point[0]), [0, 1],
  'Prior-ranked sweep should visit the next unused candidate in its initial ranking.');

// The suffix detects the majority particle, so full-window value favors the minority first.
const tail = problem(2, [[-1, 0], [0, 0], [1, 0]], [0.6, 0.4],
  (stage, point, particle) => stage === 1 ? (particle === 0 ? 1 : 0)
    : point[0] === 0 ? (particle === 0 ? 1 : 0)
      : point[0] === -1 ? (particle === 1 ? 1 : 0) : 0);
const short = solvers.compile(tail, 'bayes_mpc', { horizon: 1, beamWidth: 40 });
const continued = solvers.compile(tail, 'bs_mpc', { horizon: 1, beamWidth: 40 });
assert.equal(short.schedule[0].point[0], 0, 'Truncated MPC values the majority now.');
assert.equal(continued.schedule[0].point[0], -1, 'Continuation values coverage beyond the short horizon.');
close(short.score, 0.6, 'Short-horizon full-window acquisition');
close(continued.score, 1, 'Complementary prefix and suffix coverage');
assert(continued.score >= continued.seedScore - 1e-12, 'Continuation cannot degrade its seed.');

// A tempting first dwell cannot be accepted if it cannot rejoin the retained suffix.
const boundary = problem(3, [[-2, 0], [0, 0], [2, 0]], [1],
  (stage, point) => stage === 0 && point[0] === -2 ? 0.99 : 0.2);
boundary.limits = slow;
const boundarySeed = solvers.compile(boundary, 'tube_uniform');
assert(!solvers.transitionFeasible([-2, 0], boundarySeed.schedule[1].point, slow));
const boundaryPlan = solvers.compile(boundary, 'bs_mpc', { horizon: 1, beamWidth: 1 });
assert.notEqual(boundaryPlan.schedule[0].point[0], -2,
  'Reject a high-value prefix whose transfer into the incumbent suffix is infeasible.');
checkSchedule(boundary, boundaryPlan);

// With the entire small search retained, MPC should agree with exhaustive feasible routing.
const exact = problem(3, [[-2, 0], [0, 0], [2, 0]], [0.1, 0.2, 0.3, 0.4],
  (stage, point, particle) => ((stage * 7 + (point[0] + 2) * 3 + particle * 5 + 1) % 13) / 14);
exact.limits = slow;
let exhaustiveBest = 0;
function enumerate(stage, previous, survival) {
  if (stage === exact.candidates.length) {
    exhaustiveBest = Math.max(exhaustiveBest, 1 - survival.reduce((sum, weight) => sum + weight, 0));
    return;
  }
  for (const point of exact.candidates[stage]) {
    if (pointDistance(previous, point) > 3.19) continue;
    enumerate(stage + 1, point, survival.map((weight, particle) => weight * (1 - exact.detection(stage, point, particle))));
  }
}
enumerate(0, exact.initial, exact.weights);
for (const policy of ['bayes_mpc', 'bs_mpc']) {
  const plan = solvers.compile(exact, policy, { horizon: 3, beamWidth: 27 });
  close(plan.score, exhaustiveBest, `${policy}: full search matches exhaustive feasible coverage`);
  close(solvers.evaluate(exact, plan.schedule).score, plan.score, `${policy}: reported schedule score`);
}

const events = problem(2, [[0, 0]], [1], () => ({ correct: 0.5, false: 0.25 }));
const eventPlan = solvers.compile(events, 'bayes_greedy');
close(eventPlan.score, 0.625, 'False confirmations compete with acquisition');
close(eventPlan.schedule[1].cumulativeFalseConfirmation, 0.3125, 'False-confirmation first-event probability');
close(eventPlan.schedule[1].remainingProbability, 0.0625, 'Remaining no-confirmation probability');

const crossTrack = problem(1, [[0, 0]], [0.5, 0.5]);
crossTrack.particles = [[[0, 0], [0, 2]]];
const crossTrackPlan = solvers.compile(crossTrack, 'bayes_greedy');
close(crossTrackPlan.schedule[0].probabilities[0], 0.9, 'On-axis detection');
close(crossTrackPlan.schedule[0].probabilities[1], 0.9 * Math.exp(-8), 'Cross-track detection loss');

// An unreachable cell still produces a feasible partial move and a full-length schedule.
const limited = problem(9, [[-8, 0], [-4, 0], [0, 0], [4, 0], [8, 0]], [0.5, 0.3, 0.2]);
limited.limits = slow;
limited.initial = [0, -8];
limited.raster = Array.from({ length: 9 }, (_, index) => [index % 2 ? 8 : -8, index < 4 ? -8 : 8]);
const originalInput = JSON.stringify(limited);
const limitedSeed = solvers.compile(limited, 'tube_uniform');
for (const policy of policies) {
  const plan = solvers.compile(limited, policy, { horizon: 4, beamWidth: 1 });
  checkSchedule(limited, plan);
  if (policy === 'bs_mpc') {
    close(plan.seedScore, limitedSeed.score, 'Continuation starts from the same feasible tube sweep');
    assert(plan.score >= plan.seedScore - 1e-12, 'The incumbent safeguard must survive a one-prefix beam.');
  }
}
assert.equal(JSON.stringify(limited), originalInput, 'Planning must not mutate the shared comparison inputs.');

const coverage = problem(12, [[-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0]], [1]);
const sweep = solvers.compile(coverage, 'tube_uniform');
assert.equal(sweep.schedule[0].point[0], 0, 'The tube sweep starts at the center.');
assert.deepEqual([...new Set(sweep.schedule.map((step) => step.point[0]))].sort((a, b) => a - b),
  [-2, -1, 0, 1, 2], 'The tube sweep should cover both edges of the candidate tube.');
coverage.raster = Array.from({ length: 12 }, (_, index) => [index % 3 - 1, Math.floor(index / 3) - 1]);
const raster = solvers.compile(coverage, 'sky_raster');
assert.deepEqual(Array.from(raster.schedule, (step) => Array.from(step.point)), coverage.raster,
  'The geometric raster follows its two-dimensional route.');

console.log('Solver checks passed: seven distinct policies, Bayesian updates, two-dimensional detection, mount limits, first-event scores, and continuation safeguards.');
