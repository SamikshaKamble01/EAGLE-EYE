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


def load_image(path: Path) -> np.ndarray:
    # imdecode works with non-ASCII Windows paths, unlike imread
    data = np.fromfile(str(path), dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if image is None:
        raise ParseError("Could not decode the cabinet photo. Upload a JPG or PNG.")
    if min(image.shape[:2]) < 200:
        raise ParseError("The photo is too small (min 200 px); labels cannot be read.")
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

    expected_components = timed("pdf", pdf_service.parse_expected_components, paths["pdf"])
    expected_wiring = timed("excel", excel_service.parse_expected_wiring, paths["excel"])
    image = timed("load_image", load_image, paths["image"])
    vision = timed("vision", vision_service.detect_components, image,
                   cfg["YOLO_MODEL_PATH"], cfg["VISION_CONF_THRESHOLD"])
    ocr = timed("ocr", ocr_service.read_labels, image, cfg["OCR_ENGINE"],
                cfg["TESSERACT_CMD"], cfg["OCR_MIN_CONFIDENCE"])

    rules = rule_engine.RuleConfig(
        tag_pattern=cfg["TAG_PATTERN"],
        check_wire_labels=cfg["CHECK_WIRE_LABELS"],
        report_unexpected_labels=cfg["REPORT_UNEXPECTED_LABELS"],
    )
    result = timed("rules", rule_engine.evaluate, expected_components, expected_wiring, vision, ocr, rules)

    result["engines"] = {"vision": vision["backend"], "ocr": ocr["engine"]}
    result["expected"] = {"components": expected_components, "wiring": expected_wiring["wires"]}
    result["actual"] = {"detections": vision["detections"], "ocr_texts": ocr["texts"]}

    # ---- QC check sheet: every plug-in in app/checks/ adds its rows -------
    ctx = checks.CheckContext(expected_components, expected_wiring, vision, ocr, result,
                              image_size=(image.shape[1], image.shape[0]))
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
    timed("snippets", report_service.save_snippets, image, sheet, snippet_dir)
    annotated = timed("annotate", report_service.annotate_image, image, vision, result,
                      out_dir / f"{inspection_id}_annotated.png")
    report = timed("report", report_service.build_pdf_report, inspection_id, cabinet_name,
                   result, annotated, out_dir / f"{inspection_id}_report.pdf", snippet_dir)
    timed("checklist_xlsx", report_service.build_checklist_xlsx, inspection_id, cabinet_name,
          result, snippet_dir, out_dir / f"{inspection_id}_checklist.xlsx")

    result["timings_ms"] = timings
    log.info("Inspection %s -> %s (%.1f%%) in %s", inspection_id, result["verdict"], result["score"], timings)
    return {"result": result, "annotated_path": annotated, "report_path": report}
