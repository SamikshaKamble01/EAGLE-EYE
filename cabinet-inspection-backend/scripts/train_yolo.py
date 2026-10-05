"""Train the YOLO component detector (the real "AI detects components" step).

1. pip install ultralytics
2. Label 150-300 cabinet photos (Roboflow or CVAT, export "YOLOv8" format) with
   classes such as: circuit_breaker, contactor, relay, fuse, terminal_block,
   power_supply, plc, overload_relay, timer, vfd
   (any name containing these words is understood by the rule engine)
3. Point DATA_YAML at the exported data.yaml and run:
       python scripts/train_yolo.py
4. Copy runs/detect/cabinet/weights/best.pt to models/cabinet_yolo.pt and set
       YOLO_MODEL_PATH=models/cabinet_yolo.pt   in .env
"""
from pathlib import Path

from ultralytics import YOLO

DATA_YAML = Path("datasets/cabinet/data.yaml")

if __name__ == "__main__":
    model = YOLO("yolov8n.pt")            # small pretrained model; yolov8s.pt = more accurate
    model.train(data=str(DATA_YAML), epochs=100, imgsz=1024, batch=8,
                patience=20, project="runs/detect", name="cabinet", exist_ok=True)
    metrics = model.val()
    print("mAP50:", metrics.box.map50)
