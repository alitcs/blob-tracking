# Field / Blob Tracking

A full-screen browser experiment inspired by the supplied foliage tracking video. Uses tracking.js connected-component color detection, persistent region IDs, fine bounding boxes, and nearest-neighbor connections. The forest study animates a still photograph; camera and uploaded video modes process actual video frames locally.

## Run locally

Install Node.js (LTS), then open a terminal in this folder:

```powershell
npm install
npm start
```

Open http://127.0.0.1:5173. Stop the server with Ctrl+C. If port 5173 is occupied, run `npx http-server . -a 127.0.0.1 -p 5174 -c-1` instead.

Select **Webcam** to process your camera, or **Open video...** for your own clip. Camera access requires permission and localhost or HTTPS. Nothing is uploaded. The threshold controls the brightness of green regions selected by the detector; boxes and connections can be switched independently.

**Reference clip** plays the supplied video, which already contains its original baked-in tracking graphics. Those original graphics cannot be disabled by the checkboxes; newly detected overlays can.

The default photo is from [Unsplash](https://unsplash.com/photos/trees-in-forest-with-sun-rays-6iSZzFMKQbs), served locally as `forest.jpg`. After installing dependencies and downloading the photo, the demo does not need external services.

```powershell
npm run check
```