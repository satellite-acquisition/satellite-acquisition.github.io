/* Tangent-plane implementation of the paper's seven search policies.
 * Equations and routes: paper/sections/03_bayesian_search_mpc.tex,
 * paper/experiments/{run_synthetic_ablations,continuation_mpc}.py.
 * Mount and beam search: src/antenna_pomdp/control/{mount,rollout}.py.
 */
(function (root) {
  'use strict';

  const POLICIES = Object.freeze([
    'bs_mpc', 'bayes_mpc', 'bayes_greedy', 'frozen_greedy',
    'probability_ordered', 'tube_uniform', 'sky_raster'
  ]);
  const EPS = 1e-12;
  const sum = values => values.reduce((total, value) => total + value, 0);
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const copyPoint = point => [point[0], point[1]];

  function normalized(weights) {
    if (!weights.length || weights.some(value => !Number.isFinite(value) || value < 0)) {
      throw new Error('Particle weights must be finite and nonnegative.');
    }
    const total = sum(weights);
    if (!(total > 0)) throw new Error('At least one particle needs positive weight.');
    return weights.map(value => value / total);
  }

  function resolveLimits(limits = {}) {
    const result = { maxRate: 1.1, maxAccel: 1, interval: 6, settle: 0.5, dwell: 1.5, ...limits };
    if (![result.maxRate, result.maxAccel, result.interval, result.settle, result.dwell].every(Number.isFinite)
      || result.maxRate <= 0 || result.maxAccel <= 0 || result.interval <= 0
      || result.settle < 0 || result.dwell <= 0 || result.interval < result.settle + result.dwell) {
      throw new Error('Invalid move, settle, or dwell limits.');
    }
    return result;
  }

  function minimumSlewTime(angle, limits) {
    const { maxRate: rate, maxAccel: accel } = resolveLimits(limits);
    if (!Number.isFinite(angle) || angle < 0) throw new Error('Slew distance must be nonnegative.');
    return angle <= rate * rate / accel ? 2 * Math.sqrt(angle / accel) : angle / rate + rate / accel;
  }

  function maximumSlewDistance(limits) {
    const resolved = resolveLimits(limits);
    const duration = resolved.interval - resolved.settle - resolved.dwell;
    const { maxRate: rate, maxAccel: accel } = resolved;
    return duration <= 2 * rate / accel ? accel * duration * duration / 4 : rate * duration - rate * rate / accel;
  }

  function transitionFeasible(from, to, limits) {
    return distance(from, to) <= maximumSlewDistance(limits) + EPS;
  }

  function moveToward(from, target, limits) {
    const angle = distance(from, target);
    const fraction = angle > 0 ? Math.min(1, maximumSlewDistance(limits) / angle) : 1;
    return [from[0] + fraction * (target[0] - from[0]), from[1] + fraction * (target[1] - from[1])];
  }

  function checkedLikelihood(correct, falseConfirmation) {
    if (!Number.isFinite(correct) || !Number.isFinite(falseConfirmation)
      || correct < 0 || falseConfirmation < 0 || correct + falseConfirmation > 1 + EPS) {
      throw new Error('Detection and false-confirmation probabilities must be nonnegative and sum to at most one.');
    }
    return { correct, false: falseConfirmation, miss: Math.max(0, 1 - correct - falseConfirmation) };
  }

  function posteriorAfterMiss(weights, probabilities, falseProbabilities = null) {
    if (weights.length !== probabilities.length || (falseProbabilities && falseProbabilities.length !== weights.length)) {
      throw new Error('Weights and likelihoods must have matching lengths.');
    }
    const mass = normalized(weights).map((weight, i) => weight * checkedLikelihood(probabilities[i], falseProbabilities ? falseProbabilities[i] : 0).miss);
    if (!(sum(mass) > 0)) throw new Error('A miss has zero probability under this belief.');
    return normalized(mass);
  }

  function prepare(problem) {
    const weights = normalized(Array.from(problem.weights));
    const particles = problem.particles;
    const candidates = problem.candidates;
    const stages = particles.length;
    const validPoint = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
    if (!stages || !Array.isArray(candidates) || candidates.length !== stages
      || !validPoint(problem.initial) || particles.some(points => points.length !== weights.length || !points.every(validPoint))
      || candidates.some(points => !points.length || !points.every(validPoint))) {
      throw new Error('A contact needs particle and candidate points for every stage.');
    }
    const actions = candidates[0].length;
    if (candidates.some(points => points.length !== actions)) throw new Error('The candidate count must remain fixed through a contact.');
    if (problem.raster && (problem.raster.length !== stages || !problem.raster.every(validPoint))) {
      throw new Error('Raster targets must have one point per stage.');
    }
    const limits = resolveLimits(problem.limits);
    const reach = maximumSlewDistance(limits);
    const sigma = problem.beamSigma === undefined ? 1 : problem.beamSigma;
    if (!(sigma > 0 && Number.isFinite(sigma))) throw new Error('Beam sigma must be positive.');
    const at = (value, stage, particle, fallback) => value === undefined ? fallback : typeof value === 'number' ? value : value[stage][particle];
    function likelihood(stage, point) {
      const correct = new Float64Array(weights.length);
      const falseConfirmation = new Float64Array(weights.length);
      const miss = new Float64Array(weights.length);
      for (let i = 0; i < weights.length; i += 1) {
        let p;
        let q;
        if (problem.detection) {
          const result = problem.detection(stage, point, i);
          p = typeof result === 'number' ? result : result.correct;
          q = typeof result === 'number' || result.false === undefined ? 0 : result.false;
        } else {
          const separation = distance(point, particles[stage][i]);
          p = at(problem.peakProbability, stage, i, 0.88) * Math.exp(-0.5 * (separation / sigma) ** 2);
          q = at(problem.falseProbability, stage, i, 0);
        }
        const value = checkedLikelihood(p, q);
        correct[i] = value.correct;
        falseConfirmation[i] = value.false;
        miss[i] = value.miss;
      }
      return { correct, false: falseConfirmation, miss };
    }
    const probabilities = candidates.map((points, stage) => points.map(point => likelihood(stage, point)));
    const feasible = (from, to) => distance(from, to) <= reach + EPS;
    const transitions = candidates.slice(0, -1).map((points, stage) => points.map(from => candidates[stage + 1].map(to => feasible(from, to))));
    return { problem, weights, particles, candidates, stages, actions, limits, reach, likelihood, probabilities, feasible, transitions };
  }

  function advance(mass, likelihood) {
    const residual = new Float64Array(mass.length);
    let correct = 0;
    let falseConfirmation = 0;
    for (let i = 0; i < mass.length; i += 1) {
      correct += mass[i] * likelihood.correct[i];
      falseConfirmation += mass[i] * likelihood.false[i];
      residual[i] = mass[i] * likelihood.miss[i];
    }
    return { mass: residual, correct, false: falseConfirmation };
  }

  function immediate(mass, likelihood) {
    let value = 0;
    for (let i = 0; i < mass.length; i += 1) value += mass[i] * likelihood.correct[i];
    return value;
  }

  function completeValue(mass, likelihoods) {
    let residual = mass;
    let value = 0;
    for (const likelihood of likelihoods) {
      const next = advance(residual, likelihood);
      residual = next.mass;
      value += next.correct;
    }
    return value;
  }

  function tubeRoute(count, stages) {
    const center = Math.floor((count - 1) / 2);
    const order = [];
    for (let i = center; i < count; i += 1) order.push(i);
    for (let i = count - 2; i >= 0; i -= 1) order.push(i);
    for (let i = 1; i < center; i += 1) order.push(i);
    return Array.from({ length: stages }, (_, stage) => order[stage % order.length]);
  }

  function rasterRoute(model) {
    if (model.problem.raster) return model.problem.raster;
    const rows = [];
    [0, 0.5, -0.5, 1, -1].forEach((y, row) => {
      for (let x = 0; x < 7; x += 1) rows.push([(row % 2 ? 6 - x : x) / 3 - 1, y]);
    });
    let start = 0;
    rows.forEach((point, i) => { if (Math.hypot(...point) < Math.hypot(...rows[start])) start = i; });
    const order = rows.slice(start).concat(rows.slice(0, start));
    return model.candidates.map((points, stage) => {
      const left = points[0];
      const right = points[points.length - 1];
      const center = [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2];
      const extent = distance(left, right) / 2;
      const along = extent > 0 ? [(right[0] - left[0]) / (2 * extent), (right[1] - left[1]) / (2 * extent)] : [1, 0];
      const [x, y] = order[stage % order.length];
      return [center[0] + extent * (x * along[0] - y * along[1]), center[1] + extent * (x * along[1] + y * along[0])];
    });
  }

  function bestAction(indices, score) {
    let best = indices[0];
    let value = -Infinity;
    for (const action of indices) {
      const candidate = score(action);
      if (candidate > value + EPS) { best = action; value = candidate; }
    }
    return best;
  }

  function rankNodes(a, b) {
    if (Math.abs(b.value - a.value) > EPS) return b.value - a.value;
    for (let i = 0; i < Math.min(a.sequence.length, b.sequence.length); i += 1) {
      if (a.sequence[i] !== b.sequence[i]) return a.sequence[i] - b.sequence[i];
    }
    return a.sequence.length - b.sequence.length;
  }

  function beamSearch(mass, probabilities, initial, transitions, options, tail = null, terminal = null) {
    const horizon = probabilities.length;
    const count = probabilities[0].length;
    let viable = null;
    if (terminal) {
      viable = Array.from({ length: horizon }, () => Array(count).fill(false));
      viable[horizon - 1] = terminal.slice();
      for (let h = horizon - 2; h >= 0; h -= 1) {
        for (let a = 0; a < count; a += 1) viable[h][a] = transitions[h][a].some((allowed, b) => allowed && viable[h + 1][b]);
      }
    }
    let nodes = [{ sequence: [], mass, correct: 0, value: 0 }];
    for (let h = 0; h < horizon; h += 1) {
      const expanded = [];
      for (const node of nodes) {
        const allowed = h === 0 ? initial : transitions[h - 1][node.sequence[h - 1]];
        for (let action = 0; action < count; action += 1) {
          if (!allowed[action] || (viable && !viable[h][action])) continue;
          const next = advance(node.mass, probabilities[h][action]);
          const correct = node.correct + next.correct;
          let value = correct;
          if (tail) for (let i = 0; i < mass.length; i += 1) value += next.mass[i] * tail[i];
          expanded.push({ sequence: node.sequence.concat(action), mass: next.mass, correct, value });
        }
      }
      if (!expanded.length) return nodes[0].sequence.length ? nodes[0] : null;
      expanded.sort(rankNodes);
      nodes = expanded.slice(0, options.beamWidth);
    }
    return nodes[0];
  }

  function compileBaseline(model, policy, options) {
    const route = tubeRoute(model.actions, model.stages);
    const raster = policy === 'sky_raster' ? rasterRoute(model) : null;
    const allActions = Array.from({ length: model.actions }, (_, i) => i);
    let unused = new Set(allActions);
    let bore = model.problem.initial;
    let mass = Float64Array.from(model.weights);
    const commands = [];
    for (let stage = 0; stage < model.stages; stage += 1) {
      const candidates = model.candidates[stage];
      const probabilities = model.probabilities[stage];
      const feasible = allActions.filter(action => model.feasible(bore, candidates[action]));
      let action = null;
      let point;
      if (policy === 'sky_raster') {
        point = moveToward(bore, raster[stage], model.limits);
      } else if (policy === 'tube_uniform') {
        const preferred = route[stage];
        if (feasible.includes(preferred)) action = preferred;
        else if (feasible.length) action = bestAction(feasible, i => -distance(candidates[i], candidates[preferred]));
        point = action === null ? moveToward(bore, candidates[preferred], model.limits) : candidates[action];
      } else if (!feasible.length) {
        const belief = policy === 'bayes_greedy' || policy === 'bayes_mpc' ? mass : model.weights;
        const preferred = bestAction(allActions, i => immediate(belief, probabilities[i]));
        point = moveToward(bore, candidates[preferred], model.limits);
      } else if (policy === 'probability_ordered') {
        let pool = feasible.filter(i => unused.has(i));
        if (!pool.length) { unused = new Set(allActions); pool = feasible; }
        action = bestAction(pool, i => immediate(model.weights, probabilities[i])
          / (model.limits.dwell + model.limits.settle + minimumSlewTime(distance(bore, candidates[i]), model.limits)));
        unused.delete(action);
        point = candidates[action];
      } else if (policy === 'bayes_mpc') {
        const horizon = Math.min(options.horizon, model.stages - stage);
        const result = beamSearch(mass, model.probabilities.slice(stage, stage + horizon),
          allActions.map(i => feasible.includes(i)), model.transitions.slice(stage, stage + horizon - 1), options);
        action = result.sequence[0];
        point = candidates[action];
      } else {
        const belief = policy === 'bayes_greedy' ? mass : model.weights;
        action = bestAction(feasible, i => immediate(belief, probabilities[i]));
        point = candidates[action];
      }
      const likelihood = action === null ? model.likelihood(stage, point) : probabilities[action];
      const partialProgress = policy === 'sky_raster' ? distance(point, raster[stage]) > EPS : action === null;
      commands.push({ point: copyPoint(point), action, likelihood, partialProgress });
      bore = point;
      mass = advance(mass, likelihood).mass;
    }
    return commands;
  }

  function compileContinuation(model, options) {
    const incumbent = compileBaseline(model, 'tube_uniform', options);
    const seedScore = completeValue(model.weights, incumbent.map(command => command.likelihood));
    const improvements = [];
    let bore = model.problem.initial;
    let mass = Float64Array.from(model.weights);
    for (let stage = 0; stage < model.stages; stage += 1) {
      const horizon = Math.min(options.horizon, model.stages - stage);
      const end = stage + horizon;
      const points = model.candidates.slice(stage, end).map((candidates, h) => candidates.concat([incumbent[stage + h].point]));
      const probabilities = model.probabilities.slice(stage, end).map((values, h) => values.concat([incumbent[stage + h].likelihood]));
      const initial = points[0].map(point => model.feasible(bore, point));
      const transitions = points.slice(0, -1).map((candidates, h) => candidates.map(point => points[h + 1].map(target => model.feasible(point, target))));
      const terminal = points[horizon - 1].map(point => end === model.stages || model.feasible(point, incumbent[end].point));
      const tail = new Float64Array(model.weights.length);
      for (let h = model.stages - 1; h >= end; h -= 1) {
        const value = incumbent[h].likelihood;
        for (let i = 0; i < tail.length; i += 1) tail[i] = value.correct[i] + value.miss[i] * tail[i];
      }
      const before = completeValue(mass, incumbent.slice(stage).map(command => command.likelihood));
      const proposed = beamSearch(mass, probabilities, initial, transitions, options, tail, terminal);
      // Keep the feasible incumbent independently of finite-width pruning.
      if (proposed && proposed.sequence.length === horizon && proposed.value > before + EPS) {
        for (let h = 0; h < horizon; h += 1) {
          const action = proposed.sequence[h];
          if (action === model.actions) continue;
          incumbent[stage + h] = { point: copyPoint(points[h][action]), action, likelihood: probabilities[h][action], partialProgress: false };
        }
        improvements.push({ stage, before, after: proposed.value });
      }
      bore = incumbent[stage].point;
      mass = advance(mass, incumbent[stage].likelihood).mass;
    }
    return { commands: incumbent, seedScore, improvements };
  }

  function evaluatePrepared(model, commands) {
    let mass = Float64Array.from(model.weights);
    let cumulativeAcquisition = 0;
    let cumulativeFalseConfirmation = 0;
    const duration = model.stages * model.limits.interval;
    let restrictedMeanTime = duration;
    const schedule = commands.map((command, stage) => {
      const likelihood = command.likelihood || model.likelihood(stage, command.point || command);
      const before = sum(mass);
      const next = advance(mass, likelihood);
      mass = next.mass;
      const remainingProbability = sum(mass);
      cumulativeAcquisition += next.correct;
      cumulativeFalseConfirmation += next.false;
      restrictedMeanTime -= next.correct * (duration - (stage + 1) * model.limits.interval);
      return {
        point: copyPoint(command.point || command),
        action: command.action === undefined ? null : command.action,
        probabilities: Array.from(likelihood.correct),
        falseProbabilities: Array.from(likelihood.false),
        posterior: remainingProbability > 0 ? Array.from(mass, value => value / remainingProbability) : null,
        acquisitionProbability: before > 0 ? next.correct / before : 0,
        firstAcquisitionProbability: next.correct,
        cumulativeAcquisition,
        cumulativeFalseConfirmation,
        remainingProbability,
        partialProgress: Boolean(command.partialProgress)
      };
    });
    return { schedule, score: cumulativeAcquisition, falseScore: cumulativeFalseConfirmation, restrictedMeanTime };
  }

  function compile(problem, policy, options = {}) {
    if (!POLICIES.includes(policy)) throw new Error(`Unknown search policy: ${policy}`);
    const resolved = { horizon: 4, beamWidth: 40, ...options };
    if (!Number.isInteger(resolved.horizon) || resolved.horizon < 1 || !Number.isInteger(resolved.beamWidth) || resolved.beamWidth < 1) {
      throw new Error('Horizon and beam width must be positive integers.');
    }
    const model = prepare(problem);
    const result = policy === 'bs_mpc' ? compileContinuation(model, resolved)
      : { commands: compileBaseline(model, policy, resolved), seedScore: null, improvements: [] };
    return { policy, ...evaluatePrepared(model, result.commands), seedScore: result.seedScore, improvements: result.improvements };
  }

  function evaluate(problem, schedule) {
    const model = prepare(problem);
    if (schedule.length !== model.stages) throw new Error('Evaluation requires one command per stage.');
    return evaluatePrepared(model, schedule.map(command => ({ point: command.point || command, action: command.action, partialProgress: command.partialProgress })));
  }

  root.LeoptSolvers = Object.freeze({
    policies: POLICIES, compile, evaluate, posteriorAfterMiss,
    minimumSlewTime, maximumSlewDistance, transitionFeasible, moveToward
  });
}(typeof window === 'undefined' ? globalThis : window));
