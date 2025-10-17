Fallback assets for the Python sidecar live here (for example `main.py`, `requirements.txt`).
The actual packaged binary is bundled via `bundle.externalBin` (e.g. `python-sidecar-aarch64-apple-darwin`) and ends up at `Contents/MacOS/`, while models such as `u2net.onnx` live under `Contents/Resources/python-sidecar-models/`.
