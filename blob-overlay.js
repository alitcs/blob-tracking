/*
 * Blob overlay — drop-in, dependency-free tracking-style boxes and links.
 *
 * Usage:
 *   <script src="blob-overlay.js"></script>
 *   const overlay = BlobOverlay.create(document.querySelector('#my-panel'), { count: 65 });
 *   overlay.setCount(120);   // more / fewer boxes and lines
 *   overlay.setSpeed(0.1);  // slow down movement and flickering
 *   overlay.setBoxes(false); // hide boxes
 *   overlay.setLinks(false); // hide lines
 *   overlay.pause(); overlay.resume(); overlay.destroy();
 *
 * The canvas is transparent and ignores the mouse, so it can sit over any UI.
 * Pass document.body (or nothing) to cover the whole viewport.
 */
(function (global) {
  function create(target, options = {}) {
    target = target || document.body;
    const fullscreen = target === document.body || target === document.documentElement;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, {
      position: fullscreen ? 'fixed' : 'absolute', inset: '0', width: '100%', height: '100%',
      pointerEvents: 'none', zIndex: options.zIndex ?? 1, display: 'block'
    });
    if (!fullscreen && getComputedStyle(target).position === 'static') target.style.position = 'relative';
    target.appendChild(canvas);
    const context = canvas.getContext('2d');
    const sample = { width: 320, height: 180 };
    const settings = {
      count: options.count ?? 65,
      speed: options.speed ?? 1,
      boxes: options.boxes ?? true,
      links: options.links ?? true
    };
    const fadeDuration = .24;
    let regions = [];
    let tracks = [];
    let visibleTracks = [];
    let visibleLinks = [];
    let blobs = [];
    let clusters = [];
    let nextId = 1;
    let paused = false;
    let sceneTime = 0;
    let lastFrame;
    let lastDetection = 0;
    let nextDetection = 0;
    let needsDetection = true;
    let frame;
    let cssWidth = 1;
    let cssHeight = 1;

    function resize() {
      const bounds = fullscreen ? { width: innerWidth, height: innerHeight } : target.getBoundingClientRect();
      cssWidth = Math.max(1, bounds.width);
      cssHeight = Math.max(1, bounds.height);
      const ratio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(cssWidth * ratio);
      canvas.height = Math.round(cssHeight * ratio);
      sample.width = 320;
      sample.height = Math.max(100, Math.round(320 * cssHeight / cssWidth));
      tracks = [];
      visibleTracks = [];
      visibleLinks = [];
      blobs = [];
      clusters = [];
      needsDetection = true;
    }

    // Stands in for the foliage detector: clustered, flickering connected-component-like regions.
    function makeCluster() {
      return {
        x: Math.random() * sample.width, y: Math.random() * sample.height,
        spread: 12 + Math.random() * 38, phase: Math.random() * Math.PI * 2,
        life: 6 + Math.random() * 14
      };
    }

    function makeBlob() {
      const cluster = clusters[Math.floor(Math.random() * clusters.length)];
      const angle = Math.random() * Math.PI * 2;
      const distance = cluster.spread * Math.sqrt(-2 * Math.log(1 - Math.random() * .98)) * .6;
      const size = Math.pow(Math.random(), 2.6);
      const width = 3 + size * 15 * (.6 + Math.random() * .8);
      const height = 3 + size * 15 * (.6 + Math.random() * .8);
      return {
        cluster, offsetX: Math.cos(angle) * distance, offsetY: Math.sin(angle) * distance,
        width, height, life: .4 + Math.random() * 5
      };
    }

    function clusterDrift(cluster, time) {
      return {
        x: Math.sin(time * .085) * 6 + Math.sin(time * .3 + cluster.phase) * 3,
        y: Math.cos(time * .105) * 6 + Math.cos(time * .25 + cluster.phase) * 3
      };
    }

    function blobRegion(blob, time) {
      const drift = clusterDrift(blob.cluster, time);
      const width = Math.round(blob.width);
      const height = Math.round(blob.height);
      return {
        x: blob.cluster.x + blob.offsetX + drift.x - width / 2,
        y: blob.cluster.y + blob.offsetY + drift.y - height / 2,
        width, height, blob
      };
    }

    function generateRegions(delta) {
      const clusterCount = Math.max(3, Math.round(4 + settings.count / 12));
      clusters = clusters.filter(cluster => (cluster.life -= delta) > 0);
      while (clusters.length < clusterCount) clusters.push(makeCluster());
      blobs = blobs.filter(blob => (blob.life -= delta) > 0 && clusters.includes(blob.cluster));
      const poolSize = Math.round(settings.count * 1.25);
      if (blobs.length > poolSize) blobs.length = poolSize;
      while (blobs.length < poolSize) blobs.push(makeBlob());
      const found = [];
      for (const blob of blobs) {
        if (Math.random() < .08) continue;
        const region = blobRegion(blob, sceneTime);
        if (region.x < 0 || region.y < 0 || region.x + region.width > sample.width || region.y + region.height > sample.height) continue;
        found.push(region);
      }
      regions = found.filter(region => region.width < sample.width * .55 && region.height < sample.height * .55)
        .sort((first, second) => second.width * second.height - first.width * first.height).slice(0, settings.count);
    }

    function detect(delta) {
      generateRegions(delta);
      const unmatched = new Set(tracks);
      tracks = regions.map(region => {
        const centerX = region.x + region.width / 2;
        const centerY = region.y + region.height / 2;
        let nearest;
        let distance = 25;
        for (const previous of unmatched) {
          const currentDistance = Math.hypot(previous.x + previous.width / 2 - centerX, previous.y + previous.height / 2 - centerY);
          if (currentDistance < distance) { nearest = previous; distance = currentDistance; }
        }
        if (nearest) unmatched.delete(nearest);
        return { ...region, id: nearest ? nearest.id : nextId++ };
      });
    }

    function createVisibleTrack(region, opacity, usedIds) {
      const id = usedIds.has(region.id) ? nextId++ : region.id;
      usedIds.add(id);
      return { ...region, id, opacity };
    }

    function syncVisibleTracks() {
      const previous = new Map(visibleTracks.map(region => [region.blob, region]));
      const usedIds = new Set(tracks.map(region => previous.get(region.blob)).filter(Boolean).map(region => region.id));
      visibleTracks = tracks.map(region => {
        const visible = previous.get(region.blob);
        if (!visible) return createVisibleTrack(region, 1, usedIds);
        visible.x = region.x;
        visible.y = region.y;
        visible.opacity = 1;
        return visible;
      });
    }

    function updateVisibleTracks(delta) {
      const targets = new Map(tracks.map(region => [region.blob, region]));
      const fade = delta / fadeDuration;
      for (const visible of visibleTracks) {
        const position = blobRegion(visible.blob, sceneTime);
        visible.x = position.x;
        visible.y = position.y;
        const target = targets.get(visible.blob);
        if (target) {
          visible.opacity = Math.min(1, visible.opacity + fade);
          targets.delete(visible.blob);
        } else {
          visible.opacity = Math.max(0, visible.opacity - fade);
        }
      }
      visibleTracks = visibleTracks.filter(region => region.opacity > 0);
      const usedIds = new Set(visibleTracks.map(region => region.id));
      for (const region of targets.values()) {
        if (visibleTracks.length >= settings.count) break;
        const visible = createVisibleTrack(region, Math.min(1, fade), usedIds);
        const area = region.blob.width * region.blob.height;
        const index = visibleTracks.findIndex(other => other.blob.width * other.blob.height < area);
        if (index < 0) visibleTracks.push(visible);
        else visibleTracks.splice(index, 0, visible);
      }
    }

    function findLinks() {
      const links = [];
      for (const [index, region] of visibleTracks.entries()) {
        const centerX = region.x + region.width / 2;
        const centerY = region.y + region.height / 2;
        let nearest;
        let distance = 95;
        for (const other of visibleTracks.slice(index + 1)) {
          const currentDistance = Math.hypot(other.x + other.width / 2 - centerX, other.y + other.height / 2 - centerY);
          if (currentDistance < distance) { distance = currentDistance; nearest = other; }
        }
        if (nearest) links.push({ from: region, to: nearest });
      }
      return links;
    }

    function syncVisibleLinks() {
      visibleLinks = findLinks().map(link => ({ ...link, opacity: 1 }));
    }

    function updateVisibleLinks(delta) {
      const targets = new Map(findLinks().map(link => [link.from, link.to]));
      const active = new Set(visibleTracks);
      const fade = delta / fadeDuration;
      for (const link of visibleLinks) {
        if (!active.has(link.from) || !active.has(link.to)) {
          link.opacity = 0;
        } else if (targets.get(link.from) === link.to) {
          link.opacity = Math.min(1, link.opacity + fade);
          targets.delete(link.from);
        } else {
          link.opacity = Math.max(0, link.opacity - fade);
        }
      }
      visibleLinks = visibleLinks.filter(link => link.opacity > 0);
      for (const [from, to] of targets) {
        visibleLinks.push({ from, to, opacity: Math.min(1, fade) });
      }
    }

    function drawTracking() {
      const scaleX = canvas.width / sample.width;
      const scaleY = canvas.height / sample.height;
      const ratio = canvas.width / cssWidth;
      context.lineWidth = ratio * .7;
      if (settings.links) {
        context.strokeStyle = 'rgba(217,239,177,0.24)';
        const fadingLinks = [];
        context.beginPath();
        for (const { from, to, opacity: linkOpacity } of visibleLinks) {
          const line = [
            (from.x + from.width / 2) * scaleX, (from.y + from.height / 2) * scaleY,
            (to.x + to.width / 2) * scaleX, (to.y + to.height / 2) * scaleY
          ];
          const opacity = Math.min(linkOpacity, from.opacity, to.opacity);
          if (opacity < 1) fadingLinks.push({ line, opacity });
          else {
            context.moveTo(line[0], line[1]);
            context.lineTo(line[2], line[3]);
          }
        }
        context.stroke();
        for (const { line, opacity } of fadingLinks) {
          context.globalAlpha = opacity;
          context.beginPath();
          context.moveTo(line[0], line[1]);
          context.lineTo(line[2], line[3]);
          context.stroke();
        }
        context.globalAlpha = 1;
      }
      if (!settings.boxes) return;
      context.strokeStyle = 'rgba(227,245,194,0.7)';
      context.fillStyle = 'rgba(232,246,209,0.8)';
      context.font = `${8 * ratio}px "Courier New", monospace`;
      for (const region of visibleTracks) {
        context.globalAlpha = region.opacity;
        const left = region.x * scaleX;
        const top = region.y * scaleY;
        const width = region.width * scaleX;
        const height = region.height * scaleY;
        context.strokeRect(left, top, width, height);
        context.fillRect(left - ratio, top - ratio, ratio * 2, ratio * 2);
        if (width > 35 * ratio) context.fillText(String(region.id).padStart(3, '0'), left, top - 4 * ratio);
      }
      context.globalAlpha = 1;
    }

    function animate(timestamp) {
      const delta = lastFrame === undefined ? 0 : Math.min((timestamp - lastFrame) / 1000, .1);
      lastFrame = timestamp;
      const elapsed = paused ? 0 : delta * settings.speed;
      sceneTime += elapsed;
      const refresh = needsDetection;
      if (needsDetection || (!paused && settings.speed > 0 && sceneTime >= nextDetection)) {
        detect(Math.min(sceneTime - lastDetection, .5));
        lastDetection = sceneTime;
        if (needsDetection) {
          nextDetection = sceneTime + .08;
        } else {
          // Skip missed updates rather than replaying them after a slow frame.
          nextDetection += (Math.floor((sceneTime - nextDetection) / .08) + 1) * .08;
        }
        needsDetection = false;
      }
      if (refresh) {
        syncVisibleTracks();
        if (settings.links) syncVisibleLinks();
      } else if (elapsed > 0) {
        updateVisibleTracks(elapsed);
        if (settings.links) updateVisibleLinks(elapsed);
      }
      context.clearRect(0, 0, canvas.width, canvas.height);
      drawTracking();
      frame = requestAnimationFrame(animate);
    }

    const observer = !fullscreen && global.ResizeObserver ? new ResizeObserver(resize) : null;
    if (observer) observer.observe(target);
    else addEventListener('resize', resize);
    resize();
    frame = requestAnimationFrame(animate);

    return {
      canvas,
      setCount(value) {
        const count = Math.max(0, Math.round(Number(value) || 0));
        if (count !== settings.count) {
          settings.count = count;
          needsDetection = true;
        }
      },
      getCount() { return settings.count; },
      setSpeed(value) { settings.speed = Math.max(0, Math.min(3, Number(value) || 0)); },
      getSpeed() { return settings.speed; },
      getRegionCount() { return tracks.length; },
      setBoxes(value) { settings.boxes = Boolean(value); },
      setLinks(value) {
        const enabled = Boolean(value);
        if (enabled === settings.links) return;
        settings.links = enabled;
        if (enabled) syncVisibleLinks();
        else visibleLinks = [];
      },
      pause() { paused = true; },
      resume() { paused = false; },
      destroy() {
        cancelAnimationFrame(frame);
        if (observer) observer.disconnect();
        else removeEventListener('resize', resize);
        canvas.remove();
      }
    };
  }

  global.BlobOverlay = { create };
})(typeof window !== 'undefined' ? window : globalThis);
