'use strict';

// Circular-orbit geometry for the browser example. The paper experiments use
// Brahe/SGP4 and sampled orbital elements instead of this reduced belief.
(function () {
  const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
  const unit = a => { const norm = Math.hypot(...a); return a.map(v => v / norm); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const radians = degrees => degrees * Math.PI / 180;
  const degrees = angle => angle * 180 / Math.PI;
  const position = (lat, lng, radius) => [
    radius * Math.cos(radians(lat)) * Math.cos(radians(lng)),
    radius * Math.cos(radians(lat)) * Math.sin(radians(lng)),
    radius * Math.sin(radians(lat)),
  ];
  function project(direction, reference, along, across) {
    const cosine = Math.max(-1, Math.min(1, dot(direction, reference)));
    const angle = Math.acos(cosine), sine = Math.sin(angle);
    const scale = angle < 1e-10 ? 180 / Math.PI : degrees(angle) / Math.max(1e-12, sine);
    return [scale * dot(direction, along), scale * dot(direction, across)];
  }
  function unproject(point, reference, along, across) {
    const radius = Math.hypot(...point), angle = radians(radius);
    const scale = radius < 1e-10 ? Math.PI / 180 : Math.sin(angle) / radius;
    return unit(reference.map((value, i) => Math.cos(angle) * value
      + scale * (point[0] * along[i] + point[1] * across[i])));
  }

  class SearchDemo {
    constructor(console) { this.console = console; }

    geometry(station, time, offset = 0) {
      const c = this.console;
      const subpoint = c.subpoint(c.uNow(time) + offset, time);
      const ground = position(station.lat, station.lng, c.P.Re);
      const spacecraft = position(subpoint.lat, subpoint.lng, c.P.Re + c.P.h);
      const relative = spacecraft.map((v, i) => v - ground[i]);
      const direction = unit(relative);
      const elevation = degrees(Math.asin(Math.max(-1, Math.min(1, dot(direction, unit(ground))))));
      return { direction, elevation, range: Math.hypot(...relative) };
    }

    compile(pass) {
      if (pass.plan) return pass.plan;
      const c = this.console, slots = pass.slots;
      const prior = Array.from(c.displayGrid(slots[0].t));
      const center = prior.reduce((sum, weight, i) => sum + weight * c.deltas[i], 0);
      const sigma = Math.max(0.08, Math.sqrt(prior.reduce((sum, weight, i) => sum + weight * (c.deltas[i] - center) ** 2, 0)));
      const reference = this.geometry(pass.station, pass.start).direction;
      const later = this.geometry(pass.station, pass.start + 1).direction;
      let tangent = later.map((v, i) => v - dot(later, reference) * reference[i]);
      if (Math.hypot(...tangent) < 1e-10) tangent = cross(reference, Math.abs(reference[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]);
      const along = unit(tangent);
      const across = unit(cross(reference, along));
      const coordinates = direction => project(direction, reference, along, across);
      const crossLevels = [-2, -1, 0, 1, 2];
      const crossWeights = crossLevels.map(value => Math.exp(-value * value / 2));
      const crossTotal = crossWeights.reduce((sum, weight) => sum + weight, 0);
      const weights = prior.flatMap(weight => crossWeights.map(value => weight * value / crossTotal));
      const offsets = Array.from({ length: 17 }, (_, i) => center + (i / 16 * 5.6 - 2.8) * sigma);
      const particles = [], candidates = [], peaks = [], nominal = [];
      for (const slot of slots) {
        nominal.push(coordinates(this.geometry(pass.station, slot.t).direction));
        candidates.push(offsets.map(offset => coordinates(this.geometry(pass.station, slot.t, offset).direction)));
        const points = [], quality = [];
        for (const offset of c.deltas) {
          const geometry = this.geometry(pass.station, slot.t, offset);
          const point = coordinates(geometry.direction);
          const peak = geometry.elevation < c.P.minEl ? 0
            : Math.min(0.95, (0.55 + 0.4 * Math.sin(radians(geometry.elevation))) * Math.min(1, 1200 / geometry.range));
          for (const level of crossLevels) {
            points.push([point[0], point[1] + level * c.P.crossSigma]);
            quality.push(peak);
          }
        }
        particles.push(points); peaks.push(quality);
      }
      const problem = {
        weights, particles, candidates, initial: [0, 0],
        limits: { maxRate: c.P.maxRate, maxAccel: c.P.maxAccel, interval: c.P.interval, settle: c.P.settle, dwell: c.P.holdNom },
        beamSigma: c.P.beta, peakProbability: peaks,
      };
      const result = window.LeoptSolvers.compile(problem, c.state.strategy, { horizon: 4, beamWidth: 40 });
      pass.plan = { ...result, problem, prior, nominal, offsets, reference, along, across, crossCount: crossLevels.length };
      return pass.plan;
    }

    dwell(slot) {
      const c = this.console, plan = this.compile(slot.pass), index = slot.stage;
      const action = plan.schedule[index];
      const before = index ? plan.schedule[index - 1].posterior : plan.problem.weights;
      const probabilities = [], posterior = [];
      let probability = 0;
      for (let i = 0; i < c.deltas.length; i++) {
        let mass = 0, detected = 0, remaining = 0;
        for (let j = 0; j < plan.crossCount; j++) {
          const k = i * plan.crossCount + j;
          mass += before[k]; detected += before[k] * action.probabilities[k]; remaining += action.posterior[k];
        }
        probabilities.push(mass ? detected / mass : 0);
        posterior.push(remaining); probability += detected;
      }
      const direction = unproject(action.point, plan.reference, plan.along, plan.across);
      const station = slot.station, ground = position(station.lat, station.lng, c.P.Re);
      const gd = dot(ground, direction), radius = c.P.Re + c.P.h;
      const distance = -gd + Math.sqrt(gd * gd + radius * radius - c.P.Re * c.P.Re);
      const target = ground.map((value, i) => value + distance * direction[i]);
      const east = [-Math.sin(radians(station.lng)), Math.cos(radians(station.lng)), 0];
      const north = cross(unit(ground), east);
      const sky = {
        lat: degrees(Math.asin(target[2] / radius)), lng: degrees(Math.atan2(target[1], target[0])),
        az: (degrees(Math.atan2(dot(direction, east), dot(direction, north))) + 360) % 360,
        el: degrees(Math.asin(Math.max(-1, Math.min(1, dot(direction, unit(ground)))))),
      };
      const truth = this.geometry(station, slot.t, c.state.truthDeg);
      const truthPoint = project(truth.direction, plan.reference, plan.along, plan.across);
      const truthPeak = truth.elevation < c.P.minEl ? 0
        : Math.min(0.95, (0.55 + 0.4 * Math.sin(radians(truth.elevation))) * Math.min(1, 1200 / truth.range));
      const truthProbability = truthPeak * Math.exp(-0.5 * ((truthPoint[0] - action.point[0]) ** 2 + (truthPoint[1] - action.point[1]) ** 2) / c.P.beta ** 2);
      return { ...action, sky, probabilities, posterior, probability, truthProbability,
        aim: action.point.map((value, i) => value - plan.nominal[index][i]), contactScore: plan.score };
    }
  }
  window.LeoptSearchDemo = SearchDemo;
})();
