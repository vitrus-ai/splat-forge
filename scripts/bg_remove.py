import sys
import os
import glob
from transformers import AutoModelForImageSegmentation
import torch
from torchvision import transforms
from PIL import Image
import argparse

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input_dir", required=True, type=str)
    args = parser.parse_args()

    input_dir = args.input_dir

    print("Loading BiRefNet model for background removal...")
    torch.set_float32_matmul_precision("high")
    birefnet = AutoModelForImageSegmentation.from_pretrained("ZhengPeng7/BiRefNet", trust_remote_code=True)
    device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    birefnet.to(device)

    transform_image = transforms.Compose([
        transforms.Resize((1024, 1024)),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])

    image_files = glob.glob(os.path.join(input_dir, "*.jpg")) + glob.glob(os.path.join(input_dir, "*.png"))
    
    print(f"Found {len(image_files)} images to process.")

    for i, file_path in enumerate(image_files):
        print(f"Processing {i+1}/{len(image_files)}: {os.path.basename(file_path)}")
        try:
            im = Image.open(file_path).convert("RGB")
            image_size = im.size
            input_images = transform_image(im).unsqueeze(0).to(device)
            
            with torch.no_grad():
                preds = birefnet(input_images)[-1].sigmoid().cpu()
            
            pred = preds[0].squeeze()
            pred_pil = transforms.ToPILImage()(pred)
            mask = pred_pil.resize(image_size)
            
            im.putalpha(mask)
            
            # Create a green screen or solid background for Colmap if needed, 
            # or just save as transparent PNG.
            # Splatting often likes solid backgrounds (black/white) or transparent if supported.
            # We will save as transparent PNG, but overwrite the original if it was jpg?
            # Actually, COLMAP ignores alpha, but gaussian splatting uses it.
            # We'll save it as PNG and delete the JPG to avoid duplicates for colmap.
            
            new_path = file_path.rsplit(".", 1)[0] + ".png"
            
            # create a black background image
            bg = Image.new("RGB", im.size, (0,0,0))
            bg.paste(im, mask=im.split()[3]) # paste using alpha
            bg.save(file_path) # overwrite original jpg with black background!
            
            print(f"Successfully removed background for {os.path.basename(file_path)}")
        except Exception as e:
            print(f"Error processing {file_path}: {e}")

    print("Background removal complete.")

if __name__ == "__main__":
    main()
