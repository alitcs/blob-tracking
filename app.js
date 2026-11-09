const canvas = document.querySelector('#scene');
const context = canvas.getContext('2d', { alpha: false });
const sample = document.createElement('canvas');
const sampleContext = sample.getContext('2d', { willReadFrequently: true });
const video = document.querySelector('#video');
const sourceSelect = document.querySelector('#source');
const thresholdInput = document.querySelector('#threshold');
const boxesInput = document.querySelector('#boxes');
const linksInput = document.querySelector('#links');
const statusText = document.querySelector('#status');
const notice = document.querySelector('#notice');
const image = new Image();
let tracker;
let regions = [];
let tracks = [];
let nextId = 1;
let activeSource = 'forest';
let paused = false;
let imageReady = false;
let sceneTime = 0;
let lastFrame = 0;
let lastDetection = 0;
let frameCount = 0;
let fpsStart = 0;
let fps = 0;
let stream;
let objectUrl;
let sourceRequest = 0;

function showNotice(message) {
  notice.textContent = message;
  notice.hidden = !message;
}

function resize() {
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(innerWidth * ratio);
  canvas.height = Math.round(innerHeight * ratio);
  sample.width = 320;
  sample.height = Math.max(100, Math.round(320 * innerHeight / innerWidth));
  tracks = [];
}

function initializeTracker() {
  if (!globalThis.tracking) {
    showNotice('Tracking library missing. Run npm install, then refresh this page.');
    return;
  }
  tracking.ColorTracker.registerColor('foliage', (red, green, blue) => {
    return green > Number(thresholdInput.value) && green > red * 1.04 && green > blue * 1.13;
  });
  tracker = new tracking.ColorTracker(['foliage']);
  tracker.setMinDimension(3);
  tracker.setMinGroupSize(10);
  tracker.on('track', event => {
    regions = event.data.filter(region => region.width < sample.width * .55 && region.height < sample.height * .55)
      .sort((first, second) => second.width * second.height - first.width * first.height).slice(0, 65);
  });
}

function drawSource() {
  const source = activeSource === 'forest' ? image : video;
  const sourceWidth = activeSource === 'forest' ? image.naturalWidth : video.videoWidth;
  const sourceHeight = activeSource === 'forest' ? image.naturalHeight : video.videoHeight;
  if (!sourceWidth || !sourceHeight) return false;
  const zoom = activeSource === 'forest' ? 1.14 + Math.sin(sceneTime * .085) * .035 : 1;
  const scale = Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight) * zoom;
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  const panX = activeSource === 'forest' ? Math.sin(sceneTime * .085) * .34 : 0;
  const panY = activeSource === 'forest' ? Math.cos(sceneTime * .105) * .34 : 0;
  context.filter = activeSource === 'forest' ? 'saturate(0.85) contrast(1.13) brightness(0.77)' : 'none';
  context.drawImage(source, (canvas.width - width) * (.5 + panX), (canvas.height - height) * (.5 + panY), width, height);
  context.filter = 'none';
  return true;
}

function detect() {
  sampleContext.drawImage(canvas, 0, 0, sample.width, sample.height);
  const pixels = sampleContext.getImageData(0, 0, sample.width, sample.height);
  tracker.track(pixels.data, sample.width, sample.height);
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

function drawTracking() {
  const scaleX = canvas.width / sample.width;
  const scaleY = canvas.height / sample.height;
  const ratio = canvas.width / innerWidth;
  context.lineWidth = ratio * .7;
  if (linksInput.checked) {
    context.strokeStyle = 'rgba(217,239,177,0.24)';
    context.beginPath();
    for (const [index, region] of tracks.entries()) {
      const centerX = region.x + region.width / 2;
      const centerY = region.y + region.height / 2;
      let nearest;
      let distance = 95;
      for (const other of tracks.slice(index + 1)) {
        const currentDistance = Math.hypot(other.x + other.width / 2 - centerX, other.y + other.height / 2 - centerY);
        if (currentDistance < distance) { distance = currentDistance; nearest = other; }
      }
      if (nearest) {
        context.moveTo(centerX * scaleX, centerY * scaleY);
        context.lineTo((nearest.x + nearest.width / 2) * scaleX, (nearest.y + nearest.height / 2) * scaleY);
      }
    }
    context.stroke();
  }
  if (!boxesInput.checked) return;
  context.strokeStyle = 'rgba(227,245,194,0.7)';
  context.fillStyle = 'rgba(232,246,209,0.8)';
  context.font = `${8 * ratio}px "Courier New", monospace`;
  for (const region of tracks) {
    const left = region.x * scaleX;
    const top = region.y * scaleY;
    const width = region.width * scaleX;
    const height = region.height * scaleY;
    context.strokeRect(left, top, width, height);
    context.fillRect(left - ratio, top - ratio, ratio * 2, ratio * 2);
    if (width > 35 * ratio) context.fillText(String(region.id).padStart(3, '0'), left, top - 4 * ratio);
  }
}

function animate(timestamp) {
  const delta = lastFrame ? Math.min((timestamp - lastFrame) / 1000, .1) : 0;
  lastFrame = timestamp;
  if (!paused) sceneTime += delta;
  if (imageReady || activeSource !== 'forest') {
    if (drawSource()) {
      if (tracker && !paused && timestamp - lastDetection > 80) {
        detect();
        lastDetection = timestamp;
      }
      drawTracking();
    }
  }
  frameCount++;
  if (timestamp - fpsStart >= 1000) {
    fps = Math.round(frameCount * 1000 / (timestamp - fpsStart));
    frameCount = 0;
    fpsStart = timestamp;
    document.querySelector('#metrics').textContent = `${String(tracks.length).padStart(3, '0')} REGIONS · ${String(fps).padStart(2, '0')} FPS`;
  }
  const seconds = Math.floor(sceneTime);
  document.querySelector('#time').textContent = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0')).join(':');
  requestAnimationFrame(animate);
}

async function setSource(source, file) {
  const request = ++sourceRequest;
  showNotice('');
  video.pause();
  if (stream) { stream.getTracks().forEach(track => track.stop()); stream = undefined; }
  video.srcObject = null;
  video.removeAttribute('src');
  video.load();
  if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = undefined; }
  tracks = [];
  regions = [];
  try {
    if (source === 'camera') {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Webcam needs localhost or HTTPS.');
      const cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      if (request !== sourceRequest) { cameraStream.getTracks().forEach(track => track.stop()); return; }
      stream = cameraStream;
      video.srcObject = stream;
    } else if (source === 'reference') {
      video.src = 'blob-tracking-example.mp4';
    } else if (source === 'upload' && file) {
      objectUrl = URL.createObjectURL(file);
      video.src = objectUrl;
    }
    activeSource = source;
    if (source !== 'forest' && !paused) await video.play();
    if (request !== sourceRequest) return;
    statusText.textContent = paused ? 'PAUSED' : 'LIVE TRACKING';
    document.querySelector('h2').textContent = source === 'forest' ? 'Foliage study' : source === 'camera' ? 'Live study' : 'Motion study';
  } catch (error) {
    if (request !== sourceRequest) return;
    activeSource = 'forest';
    sourceSelect.value = 'forest';
    if (stream) { stream.getTracks().forEach(track => track.stop()); stream = undefined; }
    video.srcObject = null;
    showNotice(`Could not open source: ${error.message}`);
  }
}

document.querySelector('#pause').addEventListener('click', async () => {
  paused = !paused;
  const button = document.querySelector('#pause');
  button.title = button.ariaLabel = paused ? 'Resume animation' : 'Pause animation';
  const icon = document.createElement('i');
  icon.dataset.lucide = paused ? 'play' : 'pause';
  button.replaceChildren(icon);
  lucide.createIcons();
  statusText.textContent = paused ? 'PAUSED' : 'LIVE TRACKING';
  if (activeSource !== 'forest') {
    if (paused) video.pause();
    else { try { await video.play(); } catch (error) { showNotice(error.message); } }
  }
});
sourceSelect.addEventListener('change', () => {
  if (sourceSelect.value === 'upload') document.querySelector('#file').click();
  else setSource(sourceSelect.value);
});
document.querySelector('#file').addEventListener('change', event => {
  const file = event.target.files[0];
  if (file) setSource('upload', file);
  else sourceSelect.value = activeSource;
});
document.querySelector('#file').addEventListener('cancel', () => { sourceSelect.value = activeSource; });
thresholdInput.addEventListener('input', () => { document.querySelector('#threshold-value').value = thresholdInput.value; });
document.querySelector('#fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (error) { showNotice(`Fullscreen unavailable: ${error.message}`); }
});
video.addEventListener('error', () => {
  if (activeSource !== 'forest') { setSource('forest'); sourceSelect.value = 'forest'; showNotice('This video could not be decoded. Try an MP4 (H.264) or WebM file.'); }
});
image.onload = () => { imageReady = true; statusText.textContent = 'LIVE TRACKING'; };
image.onerror = () => showNotice('Forest image missing. Choose Reference clip, Webcam, or Open video.');
image.src = 'forest.jpg';
addEventListener('resize', resize);
resize();
lucide.createIcons();
initializeTracker();
requestAnimationFrame(animate);