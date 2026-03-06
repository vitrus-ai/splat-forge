// SplatForge – Video-to-Gaussian-Splat pipeline (Tauri 2).
// run_reconstruction_pipeline: starts FFmpeg → COLMAP → Brush → convert → output; emits events.
// get_file_size: returns file size in bytes for preview display.

mod pipeline;

use std::process::Stdio;
use tokio::io::AsyncBufReadExt;
use serde::Deserialize;
use tauri::Emitter;

#[tauri::command]
async fn check_dependencies() -> Result<Vec<String>, String> {
    let mut missing = Vec::new();

    if std::process::Command::new("ffmpeg").arg("-version").output().is_err() {
        missing.push("ffmpeg".to_string());
    }

    let colmap_candidates = ["colmap", "/usr/local/bin/colmap", "/opt/homebrew/bin/colmap"];
    if !colmap_candidates.iter().any(|c| std::process::Command::new(c).arg("-h").output().is_ok()) {
        missing.push("colmap".to_string());
    }

    let home = std::env::var("HOME").unwrap_or_default();
    let brush_candidates = vec![
        "brush".to_string(),
        "/usr/local/bin/brush".to_string(),
        "/usr/local/bin/brush_app".to_string(),
        format!("{}/.local/bin/brush", home),
    ];
    if !brush_candidates.iter().any(|c| std::process::Command::new(c).arg("-h").output().is_ok()) {
        missing.push("brush".to_string());
    }

    Ok(missing)
}

#[tauri::command]
async fn run_setup_script(app: tauri::AppHandle) -> Result<(), String> {
    let script = include_str!("../../setup.sh"); // setup.sh is in vitrus-3/splat-forge
    let temp_dir = std::env::temp_dir();
    let script_path = temp_dir.join("splatforge_setup.sh");
    std::fs::write(&script_path, script).map_err(|e| e.to_string())?;

    let mut cmd = tokio::process::Command::new("bash");
    cmd.arg(&script_path);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let app_clone1 = app.clone();
    tokio::spawn(async move {
        let mut reader = tokio::io::BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = app_clone1.emit("setup-log", line);
        }
    });

    let app_clone2 = app.clone();
    tokio::spawn(async move {
        let mut reader = tokio::io::BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = app_clone2.emit("setup-log", line);
        }
    });

    let status = child.wait().await.map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(script_path);

    if status.success() {
        Ok(())
    } else {
        Err(format!("Setup exited with status: {}", status))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunPipelineArgs {
    input_path: String,
    is_video: bool,
    output_dir: String,
    output_filename: Option<String>,
    use_difix: bool,
    use_bg_removal: bool,
}

#[tauri::command]
async fn run_reconstruction_pipeline(app: tauri::AppHandle, args: RunPipelineArgs) -> Result<(), String> {
    let app_handle = app.clone();
    let input_path = args.input_path;
    let is_video = args.is_video;
    let output_dir = args.output_dir;
    let output_filename = args.output_filename;
    let use_difix = args.use_difix;
    let use_bg_removal = args.use_bg_removal;
    tauri::async_runtime::spawn(async move {
        if let Err(e) = pipeline::run_reconstruction_pipeline(
            app_handle.clone(),
            input_path,
            is_video,
            output_dir,
            output_filename,
            use_difix,
            use_bg_removal,
        )
        .await
        {
            let _ = app_handle.emit(
                "pipeline-finished",
                pipeline::PipelineFinishedPayload {
                    success: false,
                    output_splat_path: None,
                    error: Some(e),
                },
            );
        }
    });
    Ok(())
}

#[tauri::command]
fn get_file_size(path: String) -> Result<u64, String> {
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.is_file() {
        Ok(meta.len())
    } else {
        Err("Not a file".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]

#[tauri::command]
async fn save_log_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}
pub fn run() {

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            run_reconstruction_pipeline, 
            get_file_size, 
            check_dependencies, 
            run_setup_script,
            pipeline::apply_crop,
            pipeline::apply_brush,
            pipeline::save_splat,
            pipeline::extract_multiple_videos,
            pipeline::save_base64_file,
            save_log_file,
            pipeline::download_file
        ])
        .run(tauri::generate_context!())
        .expect("error running SplatForge");
}

