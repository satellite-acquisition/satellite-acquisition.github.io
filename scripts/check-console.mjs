import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../console/console.js', import.meta.url), 'utf8');
assert(!/\b(?:LeoptLive|LEOPT_LIVE)\b|["'`]\/api\//.test(source),
  'The public demo must not depend on the Python API or live sessions.');

// Exercise the simulation without mounting React or creating a WebGL canvas.
class Component {
  constructor(props) { this.props = props; }
  setState(patch, callback) {
    Object.assign(this.state, typeof patch === 'function' ? patch(this.state, this.props) : patch);
    callback?.();
  }
  forceUpdate() {}
}

let launchTimer;
const context = vm.createContext({
  React: { Component }, window: { matchMedia: () => ({ matches: true }) }, clearInterval,
  setTimeout(callback) { launchTimer = callback; return 1; },
  fetch() { throw new Error('The simulation must work without network requests.'); },
});
vm.runInContext(source, context, { filename: 'console/console.js', timeout: 1000 });
const Console = context.window.LeoptConsole;
assert.equal(typeof Console, 'function', 'The console class must load.');

function assertBelief(grid) {
  assert(grid.every((weight) => Number.isFinite(weight) && weight >= 0),
    'Belief weights must remain finite and nonnegative.');
  assert(Math.abs(grid.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-12,
    'Belief weights must sum to one.');
}

const demo = new Console({});
let globeInitializations = 0;
demo.initGlobe = async () => { globeInitializations++; };
demo.componentDidMount();
assert.equal(globeInitializations, 0, 'The globe should wait until the console is launched.');
assert.equal(demo.renderVals().splashOpen, true);
assert.equal(demo.renderVals().dashboardOpen, false, 'The dashboard should stay hidden during the intro.');
demo.renderVals().onLaunch();
assert.equal(demo.state.splashVisible, false, 'Reduced motion should launch without an animation delay.');
assert.equal(demo.renderVals().dashboardOpen, true);
assert.equal(demo.state.playing, false, 'Launch should leave the simulation paused.');
assert.equal(globeInitializations, 1);
demo.launch();
assert.equal(globeInitializations, 1, 'Repeated launch events should not recreate the globe.');

const animated = new Console({});
context.window.matchMedia = () => ({ matches: false });
animated.setup();
animated.reducedMotion = false;
let animatedGlobeInitializations = 0;
animated.initGlobe = async () => { animatedGlobeInitializations++; };
animated.launch();
assert.equal(animated.state.launching, true);
assert.equal(animated.renderVals().dashboardOpen, false, 'Keep the dashboard hidden while the intro fades.');
assert.equal(animatedGlobeInitializations, 0);
assert.equal(typeof launchTimer, 'function', 'The animated launch must schedule its transition.');
launchTimer();
assert.equal(animated.state.launching, false);
assert.equal(animated.renderVals().dashboardOpen, true);
assert.equal(animated.state.playing, false);
assert.equal(animatedGlobeInitializations, 1);

assert.equal(demo.state.strategy, 'infogreedy');
assert(demo.schedule.length > 1, 'The sample must provide multiple observation opportunities.');
assert(demo.stations.length > 0, 'The sample must include ground stations.');
assertBelief(demo.grid);
const initialBelief = Array.from(demo.grid);
const initialSchedule = demo.schedule.map((slot) => slot.t);
assert(initialSchedule.every((time, index) => Number.isFinite(time)
  && time >= 0 && time <= demo.P.window && (index === 0 || time >= initialSchedule[index - 1])),
  'Observation opportunities must be ordered within the search window.');

const view = demo.renderVals();
assert.deepEqual(Array.from(view.planStrategies, (strategy) => strategy.label), ['GREEDY', 'SWEEP'],
  'Only the two implemented browser policies should be selectable.');
assert(view.showDwell && !view.acquired, 'The sample should begin ready for an observation.');

const slot = demo.schedule[0];
const prior = Array.from(demo.displayGrid(slot.t));
const aim = demo.planAim(slot, prior);
const quality = demo.geomQuality(slot.pass);
const expected = prior.map((weight, index) => weight
  * (1 - quality * Math.exp(-0.5 * ((demo.deltas[index] - aim) / demo.P.beta) ** 2)));
const normalizer = expected.reduce((sum, weight) => sum + weight, 0);

demo.report(false);
assert.equal(demo.state.stepIndex, 1);
assert.equal(demo.log.length, 1);
assert.equal(demo.history.length, 2);
assert.equal(demo.state.acquired, false);
assertBelief(demo.grid);
assert(demo.grid.every((weight, index) => Math.abs(weight - expected[index] / normalizer) < 1e-12),
  'A missed detection must apply the normalized Bayesian miss likelihood.');
assert(demo.grid.some((weight, index) => Math.abs(weight - prior[index]) > 1e-5),
  'The missed detection must change the belief.');

demo.report(true);
assert.equal(demo.state.acquired, true);
assert.equal(demo.state.acqT, demo.schedule[1].t);
assertBelief(demo.grid);
assert.equal(demo.renderVals().showDwell, false, 'Acquisition should end the search.');
demo.report(false);
assert.equal(demo.log.length, 2, 'Further observations must be ignored after acquisition.');

demo.reset();
assert.equal(demo.state.t, 0);
assert.equal(demo.state.stepIndex, 0);
assert.equal(demo.state.acquired, false);
assert.equal(demo.state.acqT, null);
assert.equal(demo.log.length, 0);
assert.equal(demo.history.length, 1);
assert.deepEqual(Array.from(demo.grid), initialBelief, 'Reset must restore the original belief.');
assert.deepEqual(Array.from(demo.schedule, (next) => next.t), Array.from(initialSchedule));

for (const policy of ['infogreedy', 'sweep']) {
  demo.reset();
  demo.setStrategy(policy);
  for (let index = 0; index < demo.schedule.length; index++) {
    const next = demo.schedule[index];
    const nextAim = demo.planAim(next, demo.displayGrid(next.t));
    assert(Number.isFinite(nextAim) && Math.abs(nextAim) <= 5, `${policy}: invalid pointing`);
    demo.report(false);
    assertBelief(demo.grid);
  }
  assert.equal(demo.state.stepIndex, demo.schedule.length);
  assert.equal(demo.renderVals().acqStr, 'NO ACQ');
  const completed = demo.log.length;
  demo.report(false);
  assert.equal(demo.log.length, completed, 'An exhausted schedule must not record extra observations.');
}

console.log(`Console checks passed: intro launch, Bayesian updates, acquisition, reset, and both policies across ${initialSchedule.length} observations.`);
