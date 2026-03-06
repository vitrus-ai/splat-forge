#!/usr/bin/env bash
# SplatForge setup: ensure FFmpeg, headless COLMAP, and Brush are available.
# Targets macOS (Homebrew). Linux: COLMAP build deps must be installed first (see below).
# May require sudo for: ninja install (COLMAP), cp to INSTALL_PREFIX/bin (Brush).
set -euo pipefail

COLMAP_VERSION="${COLMAP_VERSION:-}"
BRUSH_VERSION="${BRUSH_VERSION:-v0.3.0}"
INSTALL_PREFIX="${INSTALL_PREFIX:-/usr/local}"
BUILD_DIR="${BUILD_DIR:-/tmp/splatforge-build}"
FORCE_COLMAP_REBUILD="${FORCE_COLMAP_REBUILD:-0}"

echo "[SplatForge] Checking dependencies..."

# --- Detect OS ---
case "$(uname -s)" in
  Darwin) OS=macos; ARCH=$(uname -m) ;;
  Linux)  OS=linux; ARCH=$(uname -m) ;;
  *)      echo "Unsupported OS: $(uname -s)"; exit 1 ;;
esac

# --- FFmpeg ---
if command -v ffmpeg &>/dev/null; then
  echo "[OK] ffmpeg found: $(command -v ffmpeg)"
else
  echo "[INSTALL] ffmpeg..."
  if [ "$OS" = "macos" ]; then
    brew install ffmpeg
  else
    echo "Install FFmpeg manually (e.g. sudo apt install ffmpeg) then re-run."
    exit 1
  fi
fi

# --- COLMAP ---
if command -v colmap &>/dev/null && colmap -h &>/dev/null; then
  echo "[OK] colmap from PATH: $(command -v colmap)"
else
  echo "[INFO] No working colmap found."
  if [ "$OS" = "macos" ]; then
    echo "[INSTALL] Installing COLMAP via Homebrew..."
    brew install colmap
  else
    echo "[INFO] Please install COLMAP manually (e.g. sudo apt install colmap) or build from source."
    exit 1
  fi
fi

# --- Brush ---
BRUSH_BIN=""
if command -v brush &>/dev/null; then
  echo "[OK] brush: $(command -v brush)"
  BRUSH_BIN=$(command -v brush)
elif command -v brush-app &>/dev/null; then
  echo "[OK] brush-app: $(command -v brush-app)"
  BRUSH_BIN=$(command -v brush-app)
fi

if [ -z "$BRUSH_BIN" ]; then
  echo ""
  echo "=== Installing Brush ==="

  BRUSH_ARCH=""
  if [ "$OS" = "macos" ] && [ "$ARCH" = "arm64" ]; then
    BRUSH_ARCH="aarch64-apple-darwin"
  elif [ "$OS" = "macos" ] && [ "$ARCH" = "x86_64" ]; then
    BRUSH_ARCH="x86_64-apple-darwin"
  elif [ "$OS" = "linux" ] && [ "$ARCH" = "x86_64" ]; then
    BRUSH_ARCH="x86_64-unknown-linux-gnu"
  elif [ "$OS" = "linux" ] && [ "$ARCH" = "aarch64" ]; then
    BRUSH_ARCH="aarch64-unknown-linux-gnu"
  fi

  if [ -n "$BRUSH_ARCH" ]; then
    BRUSH_URL="https://github.com/ArthurBrussee/brush/releases/download/${BRUSH_VERSION}/brush-app-${BRUSH_ARCH}.tar.xz"
    BRUSH_DL="$BUILD_DIR/brush-dl"
    rm -rf "$BRUSH_DL"
    mkdir -p "$BRUSH_DL"
    cd "$BRUSH_DL"

    echo "[INFO] Downloading Brush $BRUSH_VERSION for $BRUSH_ARCH..."
    curl -sL "$BRUSH_URL" -o brush.tar.xz
    tar -xJf brush.tar.xz

    # Find the binary (might be in current dir or a subdirectory; name varies: brush, brush-app, brush_app)
    BRUSH_FILE=""
    for candidate in brush brush-app brush_app; do
      [ -f "$candidate" ] && BRUSH_FILE="$candidate" && break
    done
    if [ -z "$BRUSH_FILE" ]; then
      for dir in */; do
        for candidate in brush_app brush-app brush; do
          [ -f "${dir}${candidate}" ] && BRUSH_FILE="${dir}${candidate}" && break 2
        done
      done
    fi

    if [ -n "$BRUSH_FILE" ]; then
      chmod +x "$BRUSH_FILE"
      sudo mkdir -p "$INSTALL_PREFIX/bin"
      sudo cp "$BRUSH_FILE" "$INSTALL_PREFIX/bin/brush"
      echo "[OK] Brush installed to $INSTALL_PREFIX/bin/brush"
    else
      echo "[WARN] Could not find brush binary in tarball. Contents:"
      ls -la "$BRUSH_DL"
    fi
  else
    echo "[SKIP] No pre-built Brush for $OS/$ARCH."
    echo "       Build from source:"
    echo "         git clone https://github.com/ArthurBrussee/brush && cd brush && cargo build --release"
    echo "         sudo cp target/release/brush $INSTALL_PREFIX/bin/"
  fi
fi

# --- Summary ---
echo ""
echo "=== SplatForge setup summary ==="
echo "FFmpeg:  $(command -v ffmpeg 2>/dev/null || echo 'NOT FOUND')"
echo "COLMAP:  $(command -v colmap 2>/dev/null || echo 'NOT FOUND')"
echo "Brush:   $(command -v brush 2>/dev/null || command -v brush-app 2>/dev/null || echo 'NOT FOUND')"
echo ""
echo "If tools were installed to $INSTALL_PREFIX/bin, ensure it is on your PATH:"
echo "  export PATH=\"$INSTALL_PREFIX/bin:\$PATH\""
