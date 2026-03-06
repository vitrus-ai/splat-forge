# SplatForge

Video-to-Gaussian-Splat pipeline: turn a video (mp4/mov) or a folder of images into a trained 3D Gaussian Splat (`.splat` or `.ply`) with in-app preview.

**Stack:** Tauri 2 (Rust), React, TypeScript, Tailwind, shadcn (dark mode), React Three Fiber + Spark for .ply/.splat viewing.

## Pipeline

1. **Input** – Video file or image folder
2. **FFmpeg** – Extract frames from video (if video input)
3. **COLMAP** – Feature extraction → matching → mapper → image undistortion
4. **Brush** – Train 3D Gaussians from COLMAP output → outputs `.ply`
5. **Convert** – Optional: convert `.ply` to `.splat` via `npx @playcanvas/splat-transform` (if Node is available); otherwise the app saves `.ply`
6. **Output** – Copy `.splat` (or `.ply`) to the chosen output folder; preview in the app

## Setup (FFmpeg, COLMAP, Brush)

Before running the pipeline, install the required CLI tools. On macOS you can use the provided script:

```bash
./setup.sh
```

This will:

- Install **FFmpeg** via Homebrew if missing.
- Build **COLMAP** from source with `BUILD_GUI=OFF` (headless, no Qt/GLEW issues) and install to `/usr/local`.
- Download and install **Brush** from [releases](https://github.com/ArthurBrussee/brush/releases) on supported platforms (Apple Silicon macOS, x64 Linux). On Intel Mac or others, it prints build-from-source instructions.

If you prefer to install manually, see [Binaries](#binaries-ffmpeg-colmap-brush) below.

## Development

```bash
npm install
npm run dev          # Tauri dev (Rust + Vite)
# or
npm run dev:vite     # Frontend only
```

## Building

```bash
npm run build        # Frontend
npm run tauri build  # App bundle
```

## Binaries (FFmpeg, COLMAP, Brush)

The pipeline can use either **bundled sidecars** or **system PATH**:

- **System PATH (default):** If sidecars are not bundled, the app runs `ffmpeg`, `colmap`, and `brush` from your system. Install them (e.g. `brew install ffmpeg` on macOS, or [COLMAP](https://colmap.github.io/), [Brush](https://github.com/ArthurBrussee/brush)) and ensure they are on your PATH.
- **Bundled sidecars:** To ship the app without requiring the user to install tools:
  1. Add to `src-tauri/tauri.conf.json` under `"bundle"`:
     ```json
     "externalBin": ["bin/ffmpeg", "bin/colmap", "bin/brush"]
     ```
  2. Place binaries in `src-tauri/bin/` with the correct **target-triple** suffix (e.g. `ffmpeg-aarch64-apple-darwin` on macOS Apple Silicon). Get your triple: `rustc --print host-tuple`.

## .splat conversion

If Node.js is available, the app tries to convert the Brush `.ply` output to `.splat` using:

```bash
npx --yes @playcanvas/splat-transform input.ply output.splat
```

If that fails or Node is missing, the output is saved as `.ply` (Spark in the Preview tab supports both).

## Troubleshooting

### COLMAP: "Library not loaded: ... libGLEW.2.2.dylib"

Your COLMAP binary was linked against GLEW 2.2, but your system has a different GLEW (e.g. 2.3). Fix options:

1. **Reinstall COLMAP so it links against current GLEW** (macOS):
   ```bash
   brew install glew
   brew reinstall colmap
   ```

2. **Symlink GLEW 2.3 → 2.2** (if reinstall doesn’t help and you have GLEW 2.3):
   ```bash
   # Create opt path and symlink so COLMAP finds libGLEW.2.2.dylib
   mkdir -p /opt/homebrew/opt/glew/lib
   ln -sf /opt/homebrew/Cellar/glew/2.3.1/lib/libGLEW.2.3.dylib /opt/homebrew/opt/glew/lib/libGLEW.2.2.dylib
   ```
   (Adjust the Cellar path if your GLEW version differs; run `ls /opt/homebrew/Cellar/glew/` to check.)

3. **Use a headless COLMAP** (no GUI/GLEW) from [COLMAP releases](https://github.com/colmap/colmap/releases) or Docker, and put it on your PATH or in `src-tauri/bin/` as a sidecar.

### COLMAP: "Could not find the Qt platform plugin 'cocoa' / 'offscreen' / 'minimal'"

The app runs COLMAP with `QT_QPA_PLATFORM=minimal` so Qt doesn’t need a display. Many Homebrew COLMAP builds only ship the **cocoa** plugin, so they still fail headless. Use one of these:

1. **Headless COLMAP via Docker** (no Qt):
   ```bash
   docker pull colmap/colmap:latest
   # Run pipeline; point the app at a COLMAP binary that runs the container, or use a script that wraps docker run colmap/colmap.
   ```
   Or use a pre-built headless binary from [COLMAP releases](https://github.com/colmap/colmap/releases) if available for your OS.

2. **Build COLMAP without GUI** (no Qt):
   ```bash
   git clone https://github.com/colmap/colmap && cd colmap
   mkdir build && cd build
   cmake .. -DCMAKE_BUILD_TYPE=Release -DBUILD_GUI=OFF
   make -j && sudo make install
   ```
   Then ensure this `colmap` is first on your PATH (e.g. `/usr/local/bin`).

3. **Bundled sidecar:** Build or download a headless COLMAP for your platform and put it in `src-tauri/bin/` with the correct target-triple suffix so the app uses it instead of the system binary.
