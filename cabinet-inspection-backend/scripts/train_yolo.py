"""Train the YOLO component detector on YOUR labelled cabinet photos.

Pretrained weights (yolo26n.pt) know everyday objects only - they do NOT detect breakers,
contactors etc. until you train them on labelled cabinet photos with this script.

1. pip install ultralytics
2. Label photos (Roboflow, CVAT or Label Studio -> export "YOLO" format). Use these class
   names (or any name containing these words - see YOLO_CLASS_MAP for others):
       circuit_breaker, contactor, relay, terminal_block, fuse, switch, indicator_lamp, label
3. Folder layout:
       datasets/cabinet/
         data.yaml
         images/train/*.jpg   labels/train/*.txt
         images/val/*.jpg     labels/val/*.txt
   one .txt per image, one line per object:  <class_id> <x_center> <y_center> <width> <height>
   (all four numbers 0..1, relative to the image size)
   data.yaml:
       path: datasets/cabinet
       train: images/train
       val: images/val
       names: {0: circuit_breaker, 1: contactor, 2: relay, 3: terminal_block,
               4: fuse, 5: switch, 6: indicator_lamp, 7: label}
4. Train:   python scripts/train_yolo.py            (GPU or Google Colab strongly recommended)
   options: python scripts/train_yolo.py --model yolo26s.pt --epochs 150 --imgsz 1280
5. Check the validation numbers it prints (mAP50, precision, recall) - those are YOUR
   model's real accuracy on your validation photos.
6. Copy runs/detect/cabinet/weights/best.pt to models/cabinet_yolo.pt and set in .env:
       YOLO_MODEL_PATH=models/cabinet_yolo.pt
   Restart the backend: the startup log and /api/health then say "YOLO active".

Tip: photos are tiled at inspection time (YOLO_TILE_SIZE, default 1280 px), so train on
crops of a similar scale - e.g. export 1280 x 1280 tiles of your photos from Roboflow.
"""
import argparse
from pathlib import Path

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="datasets/cabinet/data.yaml")
    ap.add_argument("--model", default="yolo26n.pt", help="starting weights (yolo26n.pt = small & fast)")
    ap.add_argument("--epochs", type=int, default=100)
    ap.add_argument("--imgsz", type=int, default=1024)
    ap.add_argument("--batch", type=int, default=8)
    args = ap.parse_args()
    if not Path(args.data).is_file():
        raise SystemExit(f"{args.data} not found - see the instructions at the top of this file.")

    from ultralytics import YOLO

    model = YOLO(args.model)
    model.train(data=args.data, epochs=args.epochs, imgsz=args.imgsz, batch=args.batch,
                patience=20, project="runs/detect", name="cabinet", exist_ok=True)
    metrics = model.val()
    print(f"validation  mAP50={metrics.box.map50:.3f}  mAP50-95={metrics.box.map:.3f}  "
          f"precision={metrics.box.mp:.3f}  recall={metrics.box.mr:.3f}")
    print("best weights: runs/detect/cabinet/weights/best.pt")
