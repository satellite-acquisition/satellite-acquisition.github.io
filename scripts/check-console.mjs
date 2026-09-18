import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../console/console.js', import.meta.url), 'utf8');
assert(!/\b(?:LeoptLive|LEOPT_LIVE)\b|["'`]\/api\//.test(source),
  'The public demo must not depend on the Python API or live sessions.');
const html = await readFile(new URL('../console/index.html', import.meta.url), 'utf8');
const scriptSources = Array.from(html.matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*>/gi), match => match[1]);
const runtimeFiles = ['paper-solvers.js', 'search-demo.js', 'console.js', 'support.js'];
for (let index = 0; index < runtimeFiles.length; index++) {
  const position = scriptSources.indexOf(runtimeFiles[index]);
  assert(position >= 0 && (index === 0 || position > scriptSources.indexOf(runtimeFiles[index - 1])),
    'Load the solver, geometry adapter, console, and renderer in dependency order.');
}

// Exercise controller state and the real search engine without mounting React or WebGL.
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
for (const filename of runtimeFiles.slice(0, -1)) {
  vm.runInContext(await readFile(new URL(`../console/${filename}`, import.meta.url), 'utf8'),
    context, { filename: `console/${filename}`, timeout: 1000 });
}
const Console = context.window.LeoptConsole;
const solvers = context.window.LeoptSolvers;
const policies = ['bs_mpc', 'bayes_mpc', 'bayes_greedy', 'frozen_greedy',
  'probability_ordered', 'tube_uniform', 'sky_raster'];
assert.deepEqual(Array.from(solvers.policies), policies);

function assertBelief(grid) {
  assert(grid.every(weight => Number.isFinite(weight) && weight >= 0), 'Belief weights must remain finite and nonnegative.');
  assert(Math.abs(grid.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-12, 'Belief weights must sum to one.');
}
function assertWeights(actual, expected, message) {
  assert.equal(actual.length, expected.length, message);
  assert(actual.every((weight, index) => Math.abs(weight - expected[index]) < 1e-12), message);
}
function assertCommandDirection(action, plan, station) {
  const radians = angle => angle * Math.PI / 180;
  const radius = Math.hypot(...action.point);
  const angle = radians(radius);
  const expectedDirection = plan.reference.map((value, index) => Math.cos(angle) * value
    + (radius ? Math.sin(angle) / radius * (action.point[0] * plan.along[index] + action.point[1] * plan.across[index]) : 0));
  const latitude = radians(station.lat), longitude = radians(station.lng);
  const up = [Math.cos(latitude) * Math.cos(longitude), Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude)];
  const east = [-Math.sin(longitude), Math.cos(longitude), 0];
  const north = [-Math.sin(latitude) * Math.cos(longitude), -Math.sin(latitude) * Math.sin(longitude), Math.cos(latitude)];
  const azimuth = radians(action.sky.az), elevation = radians(action.sky.el);
  const reportedDirection = up.map((value, index) => value * Math.sin(elevation)
    + Math.cos(elevation) * (east[index] * Math.sin(azimuth) + north[index] * Math.cos(azimuth)));
  assertWeights(reportedDirection, expectedDirection,
    'Reported azimuth/elevation must preserve the commanded spherical direction, including large offsets.');
}

const demo = new Console({});
let globeInitializations = 0;
demo.initGlobe = async () => { globeInitializations++; demo._globeReady = true; };
demo.rebuildStations = demo.updateGlobe = demo.focusOnOrbit = () => {};
demo.componentDidMount();
assert.equal(globeInitializations, 0);
assert.equal(demo.renderVals().splashOpen, true);
assert.equal(demo.renderVals().dashboardOpen, false);
demo.renderVals().onLaunch();
assert.equal(demo.state.splashVisible, false, 'Reduced motion should launch without a delay.');
assert.equal(demo.renderVals().planOpen, true, 'Launch should open mission setup.');
assert.equal(demo.renderVals().chromeOpen, false, 'The operational console should wait for rollout.');
assert.equal(demo.state.rolledOut, false);
assert.equal(globeInitializations, 0, 'Mission setup should not initialize the globe.');
demo.cancelPlan();
assert.equal(demo.state.mode, 'plan', 'Initial setup cannot be bypassed with Cancel.');

const originalBeam = demo.config.beamWidth;
demo.setField('beamWidth', originalBeam + 0.5);
assert.equal(demo.config.beamWidth, originalBeam, 'Editing setup should not mutate the active configuration.');
demo.renderVals().onRollout();
assert.equal(demo.config.beamWidth, originalBeam + 0.5, 'Rollout must apply the edited mission.');
assert.equal(demo.state.rolledOut, true);
assert.equal(demo.state.mode, 'rehearse');
assert.equal(demo.state.playing, false);
assert.equal(globeInitializations, 1);
demo.launch();
assert.equal(globeInitializations, 1, 'Repeated launch events must not recreate the globe.');
demo.setMode('plan');
demo.setField('beamWidth', 4);
demo.cancelPlan();
assert.equal(demo.form.beamWidth, demo.config.beamWidth, 'Cancel should discard uncommitted mission edits.');
assert.equal(demo.state.mode, 'rehearse');
demo.rollout();
assert.equal(globeInitializations, 1, 'A later rollout should reuse the existing globe.');

const animated = new Console({});
context.window.matchMedia = () => ({ matches: false });
animated.setup();
animated.reducedMotion = false;
animated.initGlobe = () => { throw new Error('The intro must not initialize the globe.'); };
animated.launch();
assert.equal(animated.state.launching, true);
assert.equal(animated.renderVals().dashboardOpen, false);
assert.equal(typeof launchTimer, 'function');
launchTimer();
assert.equal(animated.state.launching, false);
assert.equal(animated.renderVals().planOpen, true, 'The animated intro should also lead to mission setup.');
assert.equal(animated.state.playing, false);

assert.equal(demo.state.strategy, 'bs_mpc');
assert(demo.schedule.length > 1 && demo.stations.length > 0);
assertBelief(demo.grid);
const initialBelief = Array.from(demo.grid);
const initialSchedule = Array.from(demo.schedule, slot => slot.t);
assert(initialSchedule.every((time, index) => Number.isFinite(time)
  && time >= 0 && time <= demo.P.window && (index === 0 || time >= initialSchedule[index - 1])));
const view = demo.renderVals();
assert.equal(view.planStrategies.length, policies.length, 'Expose all seven paper policies.');
view.planStrategies.forEach((choice, index) => {
  choice.on();
  assert.equal(demo.form.strategy, policies[index], 'Each policy button must select its own implementation.');
});
demo.form.strategy = demo.config.strategy;
assert(view.showDwell && !view.acquired);

const slot = demo.schedule[0];
const prior = Array.from(demo.displayGrid(slot.t));
const dwell = demo.plannedDwell(slot);
const cachedPlan = slot.pass.plan;
demo.renderVals();
demo.plannedDwell(slot);
assert.equal(slot.pass.plan, cachedPlan, 'Rendering should reuse the compiled contact.');
assert.equal(cachedPlan.problem.weights.length, demo.grid.length * 5, 'Detection scoring must retain the cross-track hypotheses.');
const expected = prior.map((weight, index) => weight * (1 - dwell.probabilities[index]));
const normalizer = expected.reduce((sum, weight) => sum + weight, 0);
demo.report(false);
assert.equal(demo.state.stepIndex, 1);
assert.equal(demo.log.length, 1);
assert.equal(demo.history.length, 2);
assert.equal(demo.state.acquired, false);
assertBelief(demo.grid);
assertWeights(demo.grid, expected.map(weight => weight / normalizer), 'Use the compiled detection likelihood for Bayesian miss updates.');
assert(demo.grid.some((weight, index) => Math.abs(weight - prior[index]) > 1e-5), 'The miss must change the belief.');
assertWeights(demo.displayGrid(demo.schedule[1].t), demo.grid, 'Keep the contact model fixed between its dwells.');

demo.report(true);
assert.equal(demo.state.acquired, true);
assert.equal(demo.state.acqT, demo.schedule[1].t);
assertBelief(demo.grid);
assert.equal(demo.renderVals().showDwell, false);
demo.report(false);
assert.equal(demo.log.length, 2, 'Acquisition should end the search.');
demo.reset();
assert.equal(demo.state.t, 0);
assert.equal(demo.state.stepIndex, 0);
assert.equal(demo.state.acquired, false);
assert.equal(demo.state.acqT, null);
assert.equal(demo.log.length, 0);
assert.equal(demo.history.length, 1);
assert(demo.schedule.every(next => !next.pass.plan), 'Reset must discard plans compiled from an old belief.');
assertWeights(demo.grid, initialBelief, 'Reset must restore the initial belief.');
assert.deepEqual(Array.from(demo.schedule, next => next.t), initialSchedule);

// A visible direction more than 90 degrees from the reference must not fold behind it.
const wideSlot = demo.schedule[0], wideTime = wideSlot.pass.tmax;
const savedTruth = demo.state.truthDeg;
demo.state.truthDeg = 0;
const truth = demo.search.geometry(wideSlot.station, wideTime);
const normalize = vector => vector.map(value => value / Math.hypot(...vector));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const perpendicular = normalize(cross(truth.direction, Math.abs(truth.direction[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0]));
const angle = 110 * Math.PI / 180;
const reference = truth.direction.map((value, index) => value * Math.cos(angle) - perpendicular[index] * Math.sin(angle));
const along = truth.direction.map((value, index) => value * Math.sin(angle) + perpendicular[index] * Math.cos(angle));
const jointWeights = Array(demo.grid.length * 5).fill(1 / (demo.grid.length * 5));
const widePlan = {
  reference, along, across: cross(reference, along), crossCount: 5,
  problem: { weights: jointWeights }, nominal: [[0, 0]], score: 0.2,
  schedule: [{ point: [110, 0], probabilities: jointWeights.map(() => 0.2), posterior: jointWeights }],
};
const wideAction = demo.search.dwell({ station: wideSlot.station, t: wideTime, stage: 0, pass: { plan: widePlan } });
assertCommandDirection(wideAction, widePlan, wideSlot.station);
assert(Math.abs(wideAction.sky.el - truth.elevation) < 1e-10, 'A wide-angle command should retain its actual elevation.');
const expectedPeak = Math.min(0.95, (0.55 + 0.4 * Math.sin(truth.elevation * Math.PI / 180)) * Math.min(1, 1200 / truth.range));
assert(Math.abs(wideAction.truthProbability - expectedPeak) < 1e-12, 'Projecting the matching truth must preserve its on-axis detection probability.');
demo.state.truthDeg = savedTruth;

const stationary = new context.window.LeoptSearchDemo(demo);
stationary.geometry = () => ({ direction: [0, 0, 1], range: 1000, elevation: 45 });
const fixedPass = { station: demo.stations[0], start: 0 };
fixedPass.slots = [0, 1].map(stage => ({ pass: fixedPass, station: fixedPass.station, stage, t: (stage + 1) * 6 }));
const stationaryPlan = stationary.compile(fixedPass);
assert(stationaryPlan.problem.candidates.flat(2).every(Number.isFinite), 'A stationary line of sight still needs a finite search basis.');
for (const fixedSlot of fixedPass.slots) {
  const fixedAction = stationary.dwell(fixedSlot);
  assert(fixedAction.point.every(Number.isFinite) && Number.isFinite(fixedAction.sky.el));
  assertBelief(fixedAction.posterior);
}

let observations = 0;
for (const policy of policies) {
  demo.setStrategy(policy);
  const contacts = new Set();
  for (const next of demo.schedule) {
    if (!contacts.has(next.pass) && contacts.size === 2) break;
    const newContact = !contacts.has(next.pass);
    const incoming = Array.from(demo.displayGrid(next.t));
    const action = demo.plannedDwell(next);
    if (newContact) {
      contacts.add(next.pass);
      assert.equal(next.pass.plan.policy, policy);
      assertWeights(next.pass.plan.prior, incoming, `${policy}: carry the current belief into the next contact`);
      if (policy === 'bs_mpc') assert(next.pass.plan.score >= next.pass.plan.seedScore - 1e-12);
    }
    const previousPoint = next.stage ? next.pass.plan.schedule[next.stage - 1].point : next.pass.plan.problem.initial;
    assert(solvers.transitionFeasible(previousPoint, action.point, next.pass.plan.problem.limits), `${policy}: feasible actual commands`);
    assert(Number.isFinite(action.sky.az) && Number.isFinite(action.sky.el));
    assertCommandDirection(action, next.pass.plan, next.station);
    assert(action.truthProbability >= 0 && action.truthProbability <= 1);
    demo.report(false);
    assertBelief(demo.grid);
    assertWeights(demo.grid, action.posterior, `${policy}: display the selected policy's posterior`);
    observations++;
  }
  assert.equal(contacts.size, 2, `${policy}: exercise a contact boundary`);
  assert.equal(demo.state.stepIndex, demo.log.length);
  assert.equal(demo.state.acquired, false);
}

console.log(`Console checks passed: intro → mission setup → rollout, cached joint-particle plans, Bayesian updates, acquisition/reset, and ${observations} observations across all seven policies.`);
