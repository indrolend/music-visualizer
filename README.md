# MotifViz

MotifViz is a local browser app for turning an uploaded audio file into a music-reactive video. It uses a Gradio interface for the upload flow and a headless Node renderer for the frame-by-frame particle and ferrofluid animation.

## What it does

- Upload a WAV or MP3 in the browser.
- Adjust a few simple controls such as explosion threshold, intensity, resolution, and frame rate.
- Click one button to render a downloadable MP4.
- Keep the original audio track attached to the generated video.

## Project structure

```text
app.py              # Gradio UI and launch entry point
motifviz_runner.py  # Python subprocess bridge to the Node renderer
motifviz.js         # Headless audio-reactive frame renderer and video encoder
package.json        # Node dependencies for rendering
requirements.txt    # Python dependencies for the web UI
outputs/            # Generated videos appear here
```

## Requirements

- Python 3.10+
- Node.js 18+

## Install

Install the Python dependencies:

```bash
pip install -r requirements.txt
```

Install the Node dependencies once:

```bash
npm install
```

## Run

Start the local web app:

```bash
python app.py
```

Start the local web app and request a Gradio share link:

```bash
python app.py --share
```

## User flow

1. Open the app in your browser.
2. Upload an audio file.
3. Adjust the simple settings if needed.
4. Click **Render Video**.
5. Preview the MP4 and download it from the right-hand panel.

## Notes

- The renderer writes finished videos to the local `outputs` folder.
- The Gradio layer is intentionally thin so the rendering logic stays isolated in `motifviz.js`.
- The visual system is derived from the same canvas/particle ideas used in the browser SPA, but adapted to render deterministically frame-by-frame for offline export.

