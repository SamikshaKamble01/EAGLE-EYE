"""Orchestrates one inspection: PDF + Excel + Vision + OCR -> Rule Engine -> Report."""
import logging
import time
from pathlib import Path

import cv2
import numpy as np

from app import checks
from app.errors import ParseError
from app.services import excel_service, ocr_service, pdf_service, report_service, rule_engine, vision_service

log = logging.getLogger(__name__)


def load_image(path: Path, max_pixels: int = 80_000_000) -> np.ndarray:
    # imdecode works with non-ASCII Windows paths, unlike imread
    data = np.fromfile(str(path), dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if image is None:
        raise ParseError("Could not decode the cabinet photo. Upload a JPG or PNG.")
    if min(image.shape[:2]) < 200:
        raise ParseError("The photo is too small (min 200 px); labels cannot be read.")
    if image.shape[0] * image.shape[1] > max_pixels:
        raise ParseError(f"The photo is too large ({image.shape[1]} x {image.shape[0]} px, max "
                         f"{max_pixels / 1e6:.0f} MP). Use the phone's normal photo size.")
    return image


def run_inspection(inspection_id: str, cabinet_name: str, paths: dict, cfg: dict, out_dir: Path,
                   previous: dict | None = None, round_no: int = 1) -> dict:
    """`previous` = result of the inspection this one re-checks (after a fix)."""
    timings: dict[str, float] = {}

    def timed(name, fn, *args, **kwargs):
        t0 = time.perf_counter()
        value = fn(*args, **kwargs)
        timings[name] = round((time.perf_counter() - t0) * 1000)
        return value

    # the drawing is read in a separate process while the photos are OCR'd (a big CAD drawing
    # set takes ~20 s of pure-Python parsing); parsed drawings are also cached by content
    cache_dir = Path(cfg["STORAGE_DIR"]) / "cache" if cfg.get("STORAGE_DIR") else None
    pdf_job = pdf_service.parse_in_background(Path(paths["pdf"]), cache_dir)
    # the wire list is optional: without it there are no ferrule rows on the check sheet
    expected_wiring = (timed("excel", excel_service.parse_expected_wiring, paths["excel"])
                       if paths.get("excel") else {"wires": [], "labels": []})

    # several photos of the same cabinet (front, rear, close-ups) are read one by one;
    # every detection / label keeps the number of the photo it came from
    photo_paths = paths.get("images") or [paths["image"]]
    images = timed("load_image", lambda: [load_image(p, cfg.get("MAX_IMAGE_PIXELS", 80_000_000)) for p in photo_paths])
    vision = {"backend": None, "typed": False, "detections": [], "labels": [], "yolo": None, "photos": []}
    ocr = {"engine": None, "texts": []}
    for n, image in enumerate(images):
        v = timed(f"vision_{n + 1}" if len(images) > 1 else "vision", vision_service.detect_components, image,
                  cfg["YOLO_MODEL_PATH"], cfg["VISION_CONF_THRESHOLD"],
                  imgsz=cfg.get("YOLO_IMGSZ", 1024), tile=cfg.get("YOLO_TILE_SIZE", 1280),
                  overlap=cfg.get("YOLO_TILE_OVERLAP", 0.2), iou=cfg.get("YOLO_IOU", 0.5),
                  device=cfg.get("YOLO_DEVICE", ""), class_map_text=cfg.get("YOLO_CLASS_MAP", ""))
        o = timed(f"ocr_{n + 1}" if len(images) > 1 else "ocr", ocr_service.read_labels, image, cfg["OCR_ENGINE"],
                  cfg["TESSERACT_CMD"], cfg["OCR_MIN_CONFIDENCE"],
                  cfg.get("OCR_ROTATIONS", "0"), cfg.get("OCR_TILES", False))
        vision.update(backend=v["backend"], typed=v["typed"])
        vision["detections"] += [{**d, "photo": n} for d in v["detections"]]
        vision["labels"] += [{**d, "photo": n} for d in v.get("labels", [])]
        vision["yolo"] = v.get("yolo")
        vision["photos"].append({"photo": n, "tiles": v.get("tiles", 1), **v.get("summary", {})})
        ocr["engine"] = o["engine"]
        ocr["texts"] += [{**t, "photo": n} for t in o["texts"]]
    expected_components = pdf_job.result()
    # time the drawing took in the background (0 = read from the cache); it overlapped the OCR
    timings["pdf"] = pdf_job.parse_ms

    rules = rule_engine.RuleConfig(
        tag_pattern=cfg["TAG_PATTERN"],
        check_wire_labels=cfg["CHECK_WIRE_LABELS"],
        report_unexpected_labels=cfg["REPORT_UNEXPECTED_LABELS"],
    )
    result = timed("rules", rule_engine.evaluate, expected_components, expected_wiring, vision, ocr, rules)

    result["engines"] = {"vision": vision["backend"], "ocr": ocr["engine"]}
    result["expected"] = {"components": expected_components, "wiring": expected_wiring["wires"]}
    result["actual"] = {"detections": vision["detections"], "label_detections": vision["labels"],
                        "ocr_texts": ocr["texts"]}
    # detector report: which model ran (or why the fallback did) + counts per photo and band
    totals: dict[str, int] = {}
    for p in vision["photos"]:
        for k, c in p.get("by_class", {}).items():
            totals[k] = totals.get(k, 0) + c
    result["vision"] = {"backend": vision["backend"], "yolo": vision["yolo"], "by_class": totals,
                        "photos": vision["photos"],
                        "note": ("Detections come from the YOLO model. Wiring connectivity is NOT verified by "
                                 "object detection." if vision["backend"] == "yolo" else
                                 "OpenCV fallback (untyped boxes): component identity comes from the OCR labels. "
                                 + ((vision["yolo"] or {}).get("note") or ""))}
    result["photos"] = [{"index": n, "name": Path(p).name.split("__", 1)[-1], "width": im.shape[1], "height": im.shape[0]}
                        for n, (p, im) in enumerate(zip(photo_paths, images))]

    # ---- QC check sheet: every plug-in in app/checks/ adds its rows -------
    ctx = checks.CheckContext(expected_components, expected_wiring, vision, ocr, result,
                              image_size={n: (im.shape[1], im.shape[0]) for n, im in enumerate(images)})
    sheet = timed("checks", checks.run_all, ctx)
    checks.apply_to_result(result, sheet)

    if previous is not None:
        before = checks.sheet_of(previous)
        result["recheck"] = {
            "round": round_no,
            **checks.compare(before, sheet),
            "before": {"verdict": previous["verdict"], "score": previous["score"],
                       "failed": sum(i["result"] == "FAIL" for i in before)},
            "after": {"verdict": result["verdict"], "score": result["score"],
                      "failed": sum(i["result"] == "FAIL" for i in sheet)},
        }

    snippet_dir = out_dir / "snippets"
    timed("snippets", report_service.save_snippets, images, sheet, snippet_dir)
    annotated = timed("annotate", lambda: [
        report_service.annotate_image(im, vision, result,
                                      out_dir / (f"{inspection_id}_annotated.png" if n == 0 else f"{inspection_id}_annotated_{n + 1}.png"),
                                      photo=n)
        for n, im in enumerate(images)])
    report = timed("report", report_service.build_pdf_report, inspection_id, cabinet_name,
                   result, annotated, out_dir / f"{inspection_id}_report.pdf", snippet_dir)
    timed("checklist_xlsx", report_service.build_checklist_xlsx, inspection_id, cabinet_name,
          result, snippet_dir, out_dir / f"{inspection_id}_checklist.xlsx")

    result["timings_ms"] = timings
    log.info("Inspection %s -> %s (%.1f%%) in %s", inspection_id, result["verdict"], result["score"], timings)
    return {"result": result, "annotated_path": annotated[0], "annotated_paths": annotated,
            "image_paths": [str(p) for p in photo_paths], "report_path": report}
