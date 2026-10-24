"""YOLO pipeline: tiling, coordinate mapping, duplicate merging, class filtering and
fallback behaviour. The detector itself is replaced by a stand-in `predict` function that
returns fixed boxes - it only exercises the plumbing, it is not an AI result."""
import unittest
from pathlib import Path
import tempfile

import cv2
import numpy as np

from app.errors import ParseError
from app.services import vision_service as V
from app.services.inspection_pipeline import load_image


def object_at(x1, y1, x2, y2, name="contactor", conf=0.9):
    """A stand-in detector that 'sees' one object at fixed PHOTO coordinates and reports it,
    in tile coordinates, for every tile that overlaps it (clipped to the tile)."""
    def predict_for(tiles):
        def predict(crops):
            out = []
            for tx1, ty1, tx2, ty2 in tiles[:len(crops)]:
                ix1, iy1, ix2, iy2 = max(x1, tx1), max(y1, ty1), min(x2, tx2), min(y2, ty2)
                out.append([(name, conf, [ix1 - tx1, iy1 - ty1, ix2 - tx1, iy2 - ty1])] if ix1 < ix2 and iy1 < iy2 else [])
            del tiles[:len(crops)]
            return out
        return predict
    return predict_for


class TilingTests(unittest.TestCase):
    def test_tiles_cover_the_whole_image(self):
        w, h = 4096, 3072
        tiles = V.tile_grid(w, h, 1280, 0.2)
        cover = np.zeros((h, w), bool)
        for x1, y1, x2, y2 in tiles:
            self.assertLessEqual(x2 - x1, 1280)
            cover[y1:y2, x1:x2] = True
        self.assertTrue(cover.all())
        self.assertEqual(tiles[-1][2:], (w, h))          # last tile aligned to the corner

    def test_small_image_is_one_tile(self):
        self.assertEqual(V.tile_grid(800, 600, 1280, 0.2), [(0, 0, 800, 600)])

    def test_tile_boxes_are_mapped_back_to_the_photo(self):
        image = np.zeros((3072, 4096, 3), np.uint8)
        tiles = V.tile_grid(4096, 3072, 1280, 0.2)
        # an object that lies inside several overlapping tiles
        found, n = V.detect_tiled(image, object_at(1100, 1100, 1300, 1250)(list(tiles)), 1280, 0.2)
        self.assertEqual(n, len(tiles))
        self.assertEqual(len(found), 1)                   # duplicates from overlapping tiles merged
        self.assertEqual(found[0]["bbox"], [1100, 1100, 1300, 1250])
        self.assertEqual(found[0]["type"], "contactor")

    def test_object_cut_by_a_tile_edge_is_rebuilt(self):
        image = np.zeros((3072, 4096, 3), np.uint8)
        tiles = V.tile_grid(4096, 3072, 1280, 0.2)
        # spans the edge of the first tile (x = 1280) and the start of the next (x = 1024)
        found, _ = V.detect_tiled(image, object_at(1200, 300, 1400, 500)(list(tiles)), 1280, 0.2)
        self.assertEqual([d["bbox"] for d in found], [[1200, 300, 1400, 500]])


class MergeTests(unittest.TestCase):
    def test_same_class_duplicates_merge(self):
        dets = [{"type": "relay", "class_name": "relay", "confidence": 0.9, "bbox": [0, 0, 100, 100]},
                {"type": "relay", "class_name": "relay", "confidence": 0.6, "bbox": [5, 5, 102, 98]}]
        self.assertEqual(len(V.merge_detections(dets)), 1)
        self.assertEqual(V.merge_detections(dets)[0]["confidence"], 0.9)

    def test_different_classes_are_kept(self):
        dets = [{"type": "relay", "class_name": "relay", "confidence": 0.9, "bbox": [0, 0, 100, 100]},
                {"type": "fuse", "class_name": "fuse", "confidence": 0.8, "bbox": [0, 0, 100, 100]}]
        self.assertEqual(len(V.merge_detections(dets)), 2)

    def test_separate_objects_are_kept(self):
        dets = [{"type": "fuse", "class_name": "fuse", "confidence": 0.9, "bbox": [0, 0, 50, 100]},
                {"type": "fuse", "class_name": "fuse", "confidence": 0.9, "bbox": [60, 0, 110, 100]}]
        self.assertEqual(len(V.merge_detections(dets)), 2)


class ClassTests(unittest.TestCase):
    def test_cabinet_classes_are_recognised(self):
        for name, expected in [("circuit_breaker", "circuit_breaker"), ("MCB", "circuit_breaker"),
                               ("contactor", "contactor"), ("relay", "relay"), ("terminal block", "terminal_block"),
                               ("fuse", "fuse"), ("selector_switch", "switch"), ("indicator lamp", "indicator_lamp"),
                               ("component_label", "label"), ("ferrule", "label")]:
            self.assertEqual(V.component_type(name), expected, name)

    def test_everyday_object_classes_are_ignored(self):
        for name in ("person", "car", "bottle", "tv"):
            self.assertIsNone(V.component_type(name))

    def test_custom_class_map(self):
        cmap = V.parse_class_map("km=contactor, QF = circuit_breaker")
        self.assertEqual(V.component_type("KM", cmap), "contactor")
        self.assertEqual(V.component_type("qf", cmap), "circuit_breaker")

    def test_non_component_detections_are_dropped_and_labels_kept_apart(self):
        image = np.zeros((600, 800, 3), np.uint8)
        predict = lambda crops: [[("person", 0.99, [0, 0, 100, 100]), ("label", 0.8, [10, 10, 60, 30]),
                                  ("fuse", 0.7, [200, 200, 240, 300])]]
        found, _ = V.detect_tiled(image, predict)
        self.assertEqual(sorted(d["type"] for d in found), ["fuse", "label"])


class SummaryTests(unittest.TestCase):
    def test_counts_per_band(self):
        dets = [{"type": "fuse", "bbox": [0, 10, 10, 20]}, {"type": "fuse", "bbox": [0, 310, 10, 320]},
                {"type": "relay", "bbox": [0, 390, 10, 398]}]
        s = V.summarize(dets, 400)
        self.assertEqual(s["by_class"], {"fuse": 2, "relay": 1})
        self.assertEqual([r["total"] for r in s["regions"]], [1, 0, 0, 2])


class FallbackTests(unittest.TestCase):
    def test_no_weights_configured_uses_opencv(self):
        image = np.full((600, 800, 3), 200, np.uint8)
        r = V.detect_components(image, "")
        self.assertEqual((r["backend"], r["typed"], r["yolo"]["state"]), ("opencv", False, "not_configured"))

    def test_missing_weights_file_uses_opencv(self):
        s = V.backend_status("models/does_not_exist.pt")
        self.assertEqual((s["backend"], s["yolo"]["state"]), ("opencv", "weights_missing"))
        self.assertIn("not found", s["note"])

    def test_corrupt_weights_do_not_crash(self):
        with tempfile.TemporaryDirectory() as d:
            bad = Path(d) / "broken.pt"
            bad.write_bytes(b"not a model")
            s = V.backend_status(str(bad))
            self.assertEqual(s["backend"], "opencv")
            self.assertIn(s["yolo"]["state"], ("load_failed", "ultralytics_missing"))


class ImageValidationTests(unittest.TestCase):
    def test_invalid_and_oversized_images_are_refused(self):
        with tempfile.TemporaryDirectory() as d:
            junk = Path(d) / "junk.jpg"
            junk.write_bytes(b"\xff\xd8\xff not really a jpeg")
            with self.assertRaises(ParseError):
                load_image(junk)
            big = Path(d) / "big.png"
            cv2.imwrite(str(big), np.zeros((1000, 1000, 3), np.uint8))
            with self.assertRaises(ParseError):
                load_image(big, max_pixels=500_000)
            self.assertEqual(load_image(big).shape, (1000, 1000, 3))


if __name__ == "__main__":
    unittest.main()
