const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'blob-overlay.js'), 'utf8');

function createHarness(speed) {
  let callback;
  let randomCalls = 0;
  let seed = 1;
  let boxes = [];
  let opacities = [];
  let lines = [];
  let lineStart;
  let timestamp = 1000;
  const context = {
    globalAlpha: 1,
    clearRect() { boxes = []; opacities = []; lines = []; },
    strokeRect(...rect) { boxes.push(rect); opacities.push(this.globalAlpha); },
    fillRect() {},
    fillText() {},
    beginPath() {},
    moveTo(x, y) { lineStart = [x, y]; },
    lineTo(x, y) { lines.push({ from: lineStart, to: [x, y], opacity: this.globalAlpha }); },
    stroke() {}
  };
  const canvas = {
    style: {},
    setAttribute() {},
    getContext() { return context; },
    remove() {}
  };
  const body = { appendChild() {} };
  const math = Object.create(Math);
  math.random = () => {
    randomCalls++;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const sandbox = {
    document: { body, documentElement: {}, createElement() { return canvas; } },
    innerWidth: 1200,
    innerHeight: 800,
    devicePixelRatio: 1,
    Math: math,
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame(next) { callback = next; return 1; },
    cancelAnimationFrame() { callback = undefined; }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox);
  const overlay = sandbox.BlobOverlay.create(body, { count: 65, speed });

  function step() {
    const previousCalls = randomCalls;
    const next = callback;
    assert.ok(next, 'animation frame was not scheduled');
    callback = undefined;
    next(timestamp);
    timestamp += 1000 / 60;
    return randomCalls !== previousCalls;
  }

  function advance(frames) {
    let updates = 0;
    for (let frame = 0; frame < frames; frame++) {
      if (step()) updates++;
    }
    return updates;
  }

  return {
    overlay, step, advance,
    get boxes() { return JSON.stringify(boxes); },
    get rectangles() { return boxes.map(rect => rect.slice()); },
    get opacities() { return opacities.slice(); },
    get lines() { return lines.slice(); },
    get drawing() { return JSON.stringify({ boxes, opacities, lines }); }
  };
}

test('boxes keep their size and move without jitter at every nonzero speed', () => {
  for (const speed of [0.1, 1, 3]) {
    const harness = createHarness(speed);
    harness.step();
    const initial = harness.rectangles;
    const centerDistance = (first, second) => Math.hypot(
      first[0] + first[2] / 2 - second[0] - second[2] / 2,
      first[1] + first[3] / 2 - second[1] - second[3] / 2
    );
    const isolation = initial.map((box, index) => Math.min(
      ...initial.filter((_, other) => other !== index).map(other => centerDistance(box, other))
    ));
    let box = initial[isolation.indexOf(Math.max(...isolation))];
    const [startX, startY, width, height] = box;
    let previousVelocity;
    let largestAcceleration = 0;
    const frames = Math.round(30 / speed);

    for (let frame = 0; frame < frames; frame++) {
      const previousBoxes = harness.rectangles;
      const previousOpacities = harness.opacities;
      harness.step();
      const currentBoxes = harness.rectangles;
      for (let index = 0; index < previousBoxes.length; index++) {
        if (previousOpacities[index] <= .3) continue;
        const previous = previousBoxes[index];
        assert.ok(currentBoxes.some(candidate =>
          candidate[2] === previous[2] && candidate[3] === previous[3] && centerDistance(previous, candidate) < 1
        ), `a visible box changed size or jumped at ${speed}x speed`);
      }
      const next = currentBoxes.reduce((nearest, candidate) => {
        return centerDistance(box, candidate) < centerDistance(box, nearest) ? candidate : nearest;
      });
      assert.ok(centerDistance(box, next) < 1, `a box jumped at ${speed}x speed`);
      assert.equal(next[2], width, `a box changed width at ${speed}x speed`);
      assert.equal(next[3], height, `a box changed height at ${speed}x speed`);
      const velocity = [next[0] - box[0], next[1] - box[1]];
      if (previousVelocity) {
        largestAcceleration = Math.max(largestAcceleration,
          Math.abs(velocity[0] - previousVelocity[0]), Math.abs(velocity[1] - previousVelocity[1]));
      }
      previousVelocity = velocity;
      box = next;
    }

    assert.ok(Math.hypot(box[0] - startX, box[1] - startY) > .05, `the pattern did not move at ${speed}x speed`);
    assert.ok(largestAcceleration < .01, `a box jittered at ${speed}x speed: ${largestAcceleration}`);
  }
});

test('0.1x moves and fades continuously instead of snapping between updates', () => {
  const harness = createHarness(0.1);
  harness.step();
  let movingFrames = 0;
  let fadingFrames = 0;
  let largestMovement = 0;
  let largestFade = 0;

  for (let frame = 0; frame < 100; frame++) {
    const previousBoxes = harness.rectangles;
    const previousOpacities = harness.opacities;
    harness.step();
    const nextBoxes = harness.rectangles;
    const nextOpacities = harness.opacities;
    let moved = false;
    let faded = false;
    for (let index = 0; index < previousBoxes.length; index++) {
      let nearest = -1;
      let distance = Infinity;
      for (let other = 0; other < nextBoxes.length; other++) {
        const difference = Math.max(...previousBoxes[index].map((value, dimension) => Math.abs(value - nextBoxes[other][dimension])));
        if (difference < distance) { distance = difference; nearest = other; }
      }
      assert.notEqual(nearest, -1, 'a visible box disappeared without a transition');
      largestMovement = Math.max(largestMovement, distance);
      const opacityChange = Math.abs(previousOpacities[index] - nextOpacities[nearest]);
      largestFade = Math.max(largestFade, opacityChange);
      moved ||= distance > 1e-6;
      faded ||= opacityChange > 1e-6;
    }
    if (moved) movingFrames++;
    if (faded) fadingFrames++;
    assert.ok(nextBoxes.length <= harness.overlay.getCount());
  }

  assert.ok(movingFrames > 90, `motion was visible in only ${movingFrames} frames`);
  assert.ok(fadingFrames > 0, 'transient boxes did not fade');
  assert.ok(largestMovement < .25, `a box jumped ${largestMovement} pixels in one frame`);
  assert.ok(largestFade < .0071, `a box opacity changed by ${largestFade} in one frame`);
});

test('0.1x line transitions do not pop when connections change', () => {
  const harness = createHarness(0.1);
  harness.step();
  let transitions = 0;
  for (let frame = 0; frame < 600; frame++) {
    const previous = harness.lines;
    harness.step();
    const next = harness.lines;
    const closest = (line, candidates) => candidates.find(candidate => {
      return [...line.from, ...line.to].every((value, index) => {
        return Math.abs(value - [...candidate.from, ...candidate.to][index]) < .5;
      });
    });

    for (const line of previous) {
      const match = closest(line, next);
      if (!match) assert.ok(line.opacity < .015, `a line vanished at opacity ${line.opacity}`);
      else {
        const change = Math.abs(line.opacity - match.opacity);
        assert.ok(change < .015, `a line opacity jumped by ${change}`);
        if (change > 1e-6) transitions++;
      }
    }
    for (const line of next) {
      if (!closest(line, previous)) assert.ok(line.opacity < .015, `a line appeared at opacity ${line.opacity}`);
    }
  }
  assert.ok(transitions > 0, 'no connection transitions were exercised');
});

test('speed scales random pattern updates as well as movement', () => {
  function updatesAt(speed) {
    const harness = createHarness(speed);
    harness.step();
    return harness.advance(180);
  }

  const slow = updatesAt(0.1);
  const normal = updatesAt(1);
  const fast = updatesAt(3);
  assert.ok(slow >= 3 && slow <= 4, `0.1x produced ${slow} updates in 3 seconds`);
  assert.ok(normal >= 36 && normal <= 38, `1x produced ${normal} updates in 3 seconds`);
  assert.ok(fast >= 110 && fast <= 113, `3x produced ${fast} updates in 3 seconds`);
});

test('speed zero freezes the pattern while count changes remain responsive', () => {
  const harness = createHarness(0);
  harness.step();
  assert.ok(harness.overlay.getRegionCount() > 0);
  const initial = harness.drawing;
  assert.equal(harness.advance(120), 0);
  assert.equal(harness.drawing, initial);

  harness.overlay.setCount(0);
  harness.step();
  assert.equal(harness.overlay.getRegionCount(), 0);
  assert.equal(harness.boxes, '[]');

  harness.overlay.setCount(15);
  harness.step();
  assert.ok(harness.overlay.getRegionCount() > 0);
  assert.ok(harness.overlay.getRegionCount() <= 15);
  assert.equal(harness.advance(120), 0);
});

test('pausing during a transition freezes boxes and links and still permits count changes', () => {
  const harness = createHarness(1);
  harness.step();
  harness.advance(8);
  harness.overlay.pause();
  harness.step();
  const paused = harness.drawing;
  assert.equal(harness.advance(120), 0);
  assert.equal(harness.drawing, paused);

  harness.overlay.setCount(5);
  harness.step();
  assert.ok(harness.rectangles.length <= 5);
  assert.ok(harness.overlay.getRegionCount() <= 5);
  const changed = harness.drawing;
  assert.equal(harness.advance(30), 0);
  assert.equal(harness.drawing, changed);
  harness.overlay.resume();
  harness.advance(10);
  assert.notEqual(harness.drawing, changed);
});

test('box and line visibility can be controlled independently while frozen', () => {
  const harness = createHarness(0);
  harness.step();
  assert.ok(harness.rectangles.length > 0);
  assert.ok(harness.lines.length > 0);

  harness.overlay.setBoxes(false);
  harness.step();
  assert.equal(harness.rectangles.length, 0);
  assert.ok(harness.lines.length > 0);

  harness.overlay.setLinks(false);
  harness.step();
  assert.equal(harness.lines.length, 0);
  harness.overlay.setBoxes(true);
  harness.step();
  assert.ok(harness.rectangles.length > 0);
  assert.equal(harness.lines.length, 0);

  harness.overlay.setLinks(true);
  harness.step();
  assert.ok(harness.lines.length > 0);
});

test('high counts stay bounded and reducing the count clears outgoing shapes', () => {
  const harness = createHarness(3);
  harness.overlay.setCount(300);
  harness.step();
  assert.ok(harness.overlay.getRegionCount() > 65);

  for (let frame = 0; frame < 60; frame++) {
    harness.step();
    assert.ok(harness.rectangles.length <= 300);
    assert.ok(harness.rectangles.every(rect => rect.every(Number.isFinite) && rect[2] > 0 && rect[3] > 0));
    assert.ok(harness.opacities.every(opacity => opacity > 0 && opacity <= 1));
  }

  harness.overlay.setCount(12);
  harness.step();
  assert.ok(harness.rectangles.length <= 12);
  harness.overlay.setCount(0);
  harness.step();
  assert.equal(harness.rectangles.length, 0);
  assert.equal(harness.lines.length, 0);
});

test('speed changes and pauses do not cause catch-up jitter', () => {
  const harness = createHarness(1);
  harness.step();
  assert.equal(harness.advance(2), 0);
  harness.overlay.setSpeed(0);
  assert.equal(harness.advance(120), 0);
  harness.overlay.setSpeed(0.1);
  assert.equal(harness.advance(26), 0);
  assert.equal(harness.advance(4), 1);
  harness.overlay.pause();
  assert.equal(harness.advance(120), 0);
  harness.overlay.resume();
  assert.equal(harness.advance(20), 0);
  assert.equal(harness.advance(40), 1);
});
