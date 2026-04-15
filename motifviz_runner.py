from pathlib import Path
import json
import shutil
import subprocess


def _node_command() -> str:
    node_path = shutil.which("node")
    if not node_path:
        raise RuntimeError("Node.js was not found on PATH. Install Node 18+ and try again.")
    return node_path


def _ensure_node_dependencies(working_directory: Path) -> None:
    package_json = working_directory / "package.json"
    node_modules = working_directory / "node_modules"
    if package_json.exists() and not node_modules.exists():
        raise RuntimeError(
            "Node dependencies are not installed yet. Run 'npm install' once in this folder, then start the Gradio app again."
        )


def render_motif_video(
    input_audio: str,
    output_video: Path,
    threshold: float,
    width: int,
    height: int,
    fps: int,
    intensity: float,
    working_directory: Path,
) -> dict:
    _ensure_node_dependencies(working_directory)

    command = [
        _node_command(),
        str(working_directory / "motifviz.js"),
        "-i",
        str(input_audio),
        "-o",
        str(output_video),
        "--threshold",
        str(threshold),
        "--width",
        str(width),
        "--height",
        str(height),
        "--fps",
        str(fps),
        "--intensity",
        str(intensity),
    ]

    result = subprocess.run(
        command,
        cwd=working_directory,
        capture_output=True,
        text=True,
        check=False,
    )

    if result.returncode != 0:
        error_message = result.stderr.strip() or result.stdout.strip() or "Unknown renderer error."
        raise RuntimeError(error_message)

    stdout = result.stdout.strip()
    if not stdout:
        raise RuntimeError("Renderer completed without returning a summary.")

    try:
        return json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Renderer returned unexpected output: {stdout}") from exc