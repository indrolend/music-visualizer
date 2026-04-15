
from pathlib import Path
import re
import uuid

import click
import gradio as gr

from motifviz_runner import render_motif_video


ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "outputs"
RESOLUTION_PRESETS = {
    "HD 720p (1280x720)": (1280, 720),
    "Full HD (1920x1080)": (1920, 1080),
    "Square (1080x1080)": (1080, 1080),
}
THEME = gr.themes.Soft(
    font=[gr.themes.GoogleFont("Source Sans Pro"), "Arial", "sans-serif"]
)
APP_CSS = """
.gradio-container {max-width: 1180px !important;}
.hero {
    padding: 18px 0 10px;
    text-align: center;
}
.hero h1 {
    margin: 0;
    font-size: 2.35rem;
    line-height: 1.1;
}
.hero p {
    margin: 12px auto 0;
    max-width: 720px;
    color: #4b5563;
    font-size: 1rem;
}
button.primary {
    background: linear-gradient(135deg, #2563eb, #0f172a) !important;
    color: #ffffff !important;
    border: none !important;
    border-radius: 12px !important;
    font-weight: 700 !important;
    min-height: 48px;
}
.render-note {
    font-size: 0.95rem;
    color: #475569;
    padding-top: 6px;
}
"""


def slugify_stem(file_path: str) -> str:
    stem = Path(file_path).stem
    cleaned = re.sub(r"[^a-zA-Z\d]+", "-", stem).strip("-").lower()
    return cleaned or "motifviz"


def build_summary(result: dict) -> str:
    return "\n".join(
        [
            "### Render complete",
            f"- Duration: {result['durationSeconds']} seconds",
            f"- Frames: {result['frames']}",
            f"- Resolution: {result['resolution']}",
            f"- FPS: {result['fps']}",
            f"- Saved to: `{Path(result['output']).name}`",
        ]
    )


def generate_video(audio_file, explosion_threshold, intensity, resolution_label, fps):
    if not audio_file:
        raise gr.Error("Upload an audio file before starting a render.")

    width, height = RESOLUTION_PRESETS[resolution_label]
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    output_name = f"{slugify_stem(audio_file)}-{uuid.uuid4().hex[:8]}.mp4"
    output_path = OUTPUT_DIR / output_name

    result = render_motif_video(
        input_audio=audio_file,
        output_video=output_path,
        threshold=explosion_threshold,
        width=width,
        height=height,
        fps=fps,
        intensity=intensity,
        working_directory=ROOT,
    )

    summary = build_summary(result)
    return str(output_path), str(output_path), summary


def ui():
    with gr.Blocks(title="MotifViz") as demo:
        gr.HTML(
            """
            <div class="hero">
                <h1>MotifViz</h1>
                <p>
                    Upload an audio file and render a local music-reactive video with a
                    ferrofluid core, particle orbit, and explosion/reform pulses.
                </p>
            </div>
            """
        )

        with gr.Row(equal_height=False):
            with gr.Column(scale=1):
                audio_input = gr.Audio(
                    label="Audio input",
                    type="filepath",
                    sources=["upload", "microphone"],
                )
                threshold_input = gr.Slider(
                    label="Explosion threshold",
                    minimum=0.2,
                    maximum=1.0,
                    value=0.58,
                    step=0.01,
                    info="Higher values make explosions trigger on stronger beats only.",
                )
                intensity_input = gr.Slider(
                    label="Visual intensity",
                    minimum=0.6,
                    maximum=1.6,
                    value=1.0,
                    step=0.05,
                )

                with gr.Accordion("Advanced", open=False):
                    resolution_input = gr.Dropdown(
                        label="Resolution",
                        choices=list(RESOLUTION_PRESETS.keys()),
                        value="HD 720p (1280x720)",
                    )
                    fps_input = gr.Dropdown(
                        label="Frame rate",
                        choices=[24, 30, 60],
                        value=30,
                    )

                render_button = gr.Button("Render Video", variant="primary")
                gr.Markdown(
                    "The output includes the original audio track and is saved as an MP4 in the local outputs folder.",
                    elem_classes=["render-note"],
                )

            with gr.Column(scale=1):
                video_output = gr.Video(label="Preview")
                file_output = gr.File(label="Download video")
                summary_output = gr.Markdown(label="Render summary")

        render_button.click(
            fn=generate_video,
            inputs=[
                audio_input,
                threshold_input,
                intensity_input,
                resolution_input,
                fps_input,
            ],
            outputs=[video_output, file_output, summary_output],
        )

    return demo


@click.command()
@click.option("--debug", is_flag=True, default=False, help="Enable Gradio debug mode.")
@click.option("--share", is_flag=True, default=False, help="Create a Gradio share link.")
def main(debug: bool, share: bool):
    demo = ui()
    demo.queue(default_concurrency_limit=1).launch(
        debug=debug,
        share=share,
        inbrowser=True,
        theme=THEME,
        css=APP_CSS,
    )


if __name__ == "__main__":
    main()
