#!/usr/bin/env python3
import os
import sys
import json
import argparse
import numpy as np

# A script to parse COLMAP poses, interpolate novel poses, and render the initial .ply
# In a full implementation, this would import `gsplat` or `taichi-splatting` to render.

def parse_colmap_cameras(cameras_file):
    # Parse cameras.txt
    cameras = {}
    with open(cameras_file, 'r') as f:
        for line in f:
            if line.startswith('#'): continue
            parts = line.strip().split()
            if not parts: continue
            cam_id = int(parts[0])
            model = parts[1]
            width = int(parts[2])
            height = int(parts[3])
            params = [float(x) for x in parts[4:]]
            cameras[cam_id] = {'model': model, 'width': width, 'height': height, 'params': params}
    return cameras

def parse_colmap_images(images_file):
    # Parse images.txt
    images = {}
    with open(images_file, 'r') as f:
        lines = f.readlines()
        i = 0
        while i < len(lines):
            line = lines[i]
            if line.startswith('#'):
                i += 1
                continue
            parts = line.strip().split()
            if not parts:
                i += 1
                continue
            img_id = int(parts[0])
            qw, qx, qy, qz = [float(x) for x in parts[1:5]]
            tx, ty, tz = [float(x) for x in parts[5:8]]
            cam_id = int(parts[8])
            name = parts[9]
            
            # Convert q, t to 4x4 matrix
            images[img_id] = {
                'q': [qw, qx, qy, qz],
                't': [tx, ty, tz],
                'camera_id': cam_id,
                'name': name
            }
            i += 2 # Skip the points2D line
    return images

def interpolate_poses(images, num_novel=10):
    # Sort images by ID or name to get a sequence
    img_ids = sorted(list(images.keys()))
    if len(img_ids) < 2:
        return []
    
    # Just a simple interpolation logic: pick pairs and interpolate between them
    # For a real pipeline, we might want to perturb cameras slightly instead of interpolating,
    # or generate a wide circular path.
    novel_poses = []
    
    # Let's generate a few novel views by perturbing the first few cameras
    # This simulates angles that were "underconstrained"
    for i in range(min(num_novel, len(img_ids))):
        base_img = images[img_ids[i]]
        t = np.array(base_img['t'])
        
        # Perturb translation slightly (e.g. shift along X or Z)
        t_novel = t + np.random.uniform(-0.5, 0.5, size=3)
        
        novel_poses.append({
            'q': base_img['q'], # Keep rotation same
            't': t_novel.tolist(),
            'camera_id': base_img['camera_id'],
            'name': f"novel_view_{i}.png"
        })
        
    return novel_poses

def render_novel_views(ply_path, novel_poses, cameras, output_dir):
    """
    This function should use gsplat or taichi-splatting to load the .ply
    and render the images at `novel_poses` using intrinsics from `cameras`.
    """
    os.makedirs(output_dir, exist_ok=True)
    
    print(f"[RENDER] Loading SPLAT from {ply_path}")
    print(f"[RENDER] Rendering {len(novel_poses)} novel views...")
    
    # MOCK implementation
    # In a real environment, you would:
    # 1. Initialize gsplat Rasterizer
    # 2. Load .ply parameters (means, scales, quats, shs, opacities)
    # 3. For each pose, construct view matrix and projection matrix
    # 4. Rasterize and save to PNG
    
    for pose in novel_poses:
        out_path = os.path.join(output_dir, pose['name'])
        # Mocking a saved image
        with open(out_path, 'wb') as f:
            f.write(b'MOCK_IMAGE_DATA')
        print(f"[RENDER] Saved {out_path}")
        
    # Also save the poses to a JSON file so the Rust orchestrator or python sidecar
    # knows how to append them back to COLMAP
    poses_info = {
        'cameras': cameras,
        'novel_poses': novel_poses
    }
    with open(os.path.join(output_dir, 'novel_poses.json'), 'w') as f:
        json.dump(poses_info, f, indent=2)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ply', required=True, help="Path to initial .ply splat")
    parser.add_argument('--colmap_dir', required=True, help="Path to COLMAP sparse/0 or dense dir")
    parser.add_argument('--output_dir', required=True, help="Where to save rendered images and poses")
    parser.add_argument('--num_novel', type=int, default=10, help="Number of novel views to render")
    
    args = parser.parse_args()
    
    cameras_txt = os.path.join(args.colmap_dir, 'cameras.txt')
    images_txt = os.path.join(args.colmap_dir, 'images.txt')
    
    if not os.path.exists(cameras_txt) or not os.path.exists(images_txt):
        print(f"[ERROR] COLMAP txt files not found in {args.colmap_dir}")
        sys.exit(1)
        
    cameras = parse_colmap_cameras(cameras_txt)
    images = parse_colmap_images(images_txt)
    
    novel_poses = interpolate_poses(images, num_novel=args.num_novel)
    
    render_novel_views(args.ply, novel_poses, cameras, args.output_dir)
    print("[RENDER] Novel view rendering complete.")

if __name__ == "__main__":
    main()
