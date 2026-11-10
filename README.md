# Blob Overlay

A dependency-free, transparent overlay that draws the tracking-style pattern (fine bounding boxes, persistent 3-digit IDs, nearest-neighbor connection lines). It no longer detects foliage; regions are generated procedurally and fed through the same ID matching and drawing code.

## Run locally

```powershell
npm install
npm start
```

Open http://127.0.0.1:5173. You get a black screen with controls (bottom-left) to set how many boxes and lines are drawn and how quickly they move and fade. Boxes keep their size and drift smoothly, while connections fade between changes. Speed 0 freezes the animation; changing the count still updates the display. You can also just double-click `index.html`.

## Use in another project

Copy `blob-overlay.js` into your project. It needs no other files.

```html
<script src="blob-overlay.js"></script>
<script>
  // Cover the whole viewport...
  const overlay = BlobOverlay.create(document.body, { count: 65 });
  // ...or only one element (it will be given position: relative if it is static).
  // const overlay = BlobOverlay.create(document.querySelector('#panel'), { count: 65 });

  overlay.setCount(120);   // more / fewer boxes and lines
  overlay.setSpeed(1.5);   // 0 pauses movement; 1 is normal speed; max is 3
  overlay.setBoxes(false); // toggle boxes
  overlay.setLinks(false); // toggle lines
  overlay.pause(); overlay.resume();
  overlay.destroy();       // removes the canvas
</script>
```

Options: `count` (default 65), `speed` (default 1, range 0–3), `boxes` (default true), `links` (default true), `zIndex` (default 1). The canvas is transparent and uses `pointer-events: none`, so the UI underneath stays clickable.

```powershell
npm run check
```
