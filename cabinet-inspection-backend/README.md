# Cabinet Inspection Backend (Flask)

Upload a **cabinet photo + drawing PDF + wiring Excel** → get **PASS / FAIL + defects**,
an annotated photo and a PDF report. Every result is stored in a database.

```
POST /api/inspections
   ├── PDF Service     -> expected components   (app/services/pdf_service.py)
   ├── Excel Service   -> expected wiring/labels (app/services/excel_service.py)
   ├── Vision Service  -> detected components    (app/services/vision_service.py)
   ├── OCR Service     -> labels read            (app/services/ocr_service.py)
   └── Rule Engine     -> expected vs actual     (app/services/rule_engine.py)
           ├── Database (SQLite)                 (app/db.py)
           └── Report (annotated PNG + PDF)      (app/services/report_service.py)
```

---

## Step-by-step in Antigravity (Windows)

### Step 1 – Install the tools (once)
1. **Python 3.11 or 3.12** – https://www.python.org/downloads/ → tick **"Add python.exe to PATH"**.
2. **Tesseract OCR** – download the Windows installer from
   https://github.com/UB-Mannheim/tesseract/wiki and install with defaults
   (`C:\Program Files\Tesseract-OCR\`).
3. **Antigravity** – install and sign in.

### Step 2 – Open the project
1. Unzip `cabinet-inspection-backend.zip`, e.g. to `D:\projects\cabinet-inspection-backend`.
2. Antigravity → **File → Open Folder** → pick that folder.
3. Open a terminal: **Terminal → New Terminal** (or ``Ctrl + ` ``).

### Step 3 – Create a virtual environment and install packages
```powershell
python -m venv .venv
.venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```
(If PowerShell blocks `activate`, run once:
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.)
Then press `Ctrl+Shift+P` → **Python: Select Interpreter** → choose `.venv`.

Mac/Linux: `source .venv/bin/activate`, and install Tesseract with
`brew install tesseract` / `sudo apt install tesseract-ocr`.

### Step 4 – Configure
```powershell
copy .env.example .env
```
Open `.env` and set:
```
TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe
CORS_ORIGINS=http://localhost:5173      # your frontend URL
```

### Step 5 – Make sample files and run the tests
```powershell
python scripts/make_samples.py     # creates samples/ (bom.pdf, wiring.xlsx, 2 photos)
python -m pytest -v                # 18 tests: parsers, rules, full API flow
```
All 18 should pass. `cabinet_good.png` must give **PASS**; `cabinet_bad.png`
must give **FAIL** with exactly: K2 missing, K1 labelled K7, wire 105 missing,
undocumented Q9.

### Step 6 – Start the server
```powershell
python run.py          # development, auto-reload
# or
python serve.py        # production (waitress)
```
Open http://127.0.0.1:5000/api/health → `"status": "ok"`.

### Step 7 – Try a real request
Option A – install the **REST Client** extension, open `api.http`, click **Send Request**.
Option B – PowerShell:
```powershell
curl.exe -X POST http://127.0.0.1:5000/api/inspections `
  -F "image=@samples/cabinet_bad.png" -F "pdf=@samples/bom.pdf" `
  -F "excel=@samples/wiring.xlsx" -F "cabinet_name=CC-01"
```

### Step 8 – Using Antigravity's agent on this project
Good prompts once the project is open:
- *"Read README.md and app/services/rule_engine.py, then add a rule that flags wire colours that don't match the Excel 'Colour' column."*
- *"Run `python -m pytest -v` and fix anything that fails."*
- *"Write a React page that posts to /api/inspections and shows the verdict, defects table and annotated image."*

Let the agent run tests after every change – the test suite is your safety net.

---

## API

| Method | URL | What it does |
|---|---|---|
| GET | `/api/health` | Status of OCR / vision / DB |
| POST | `/api/inspections` (alias `/api/inspection`) | multipart: `image`, `pdf`, `excel`, optional `cabinet_name`. Runs the full pipeline, returns 201 + result |
| GET | `/api/inspections?limit=20&offset=0&verdict=FAIL` | History |
| GET | `/api/inspections/<id>` | One inspection with full result |
| GET | `/api/inspections/<id>/defects?severity=critical` | Defects only |
| GET | `/api/inspections/<id>/report?download=1` | PDF report |
| GET | `/api/inspections/<id>/annotated-image` | Photo with boxes (green OK, orange mismatch, blue detections) |
| GET | `/api/inspections/<id>/image` | Original photo |
| DELETE | `/api/inspections/<id>` | Delete record + files |

### Response (shortened)
```json
{
  "id": "d22d773c...", "status": "completed", "verdict": "FAIL", "score": 76.9,
  "result": {
    "summary": {"critical": 1, "major": 2, "minor": 1, "checks_total": 13, "checks_passed": 10},
    "defects": [
      {"code": "COMPONENT_MISSING", "severity": "critical", "item": "K2",
       "message": "K2 - Contactor 24VDC 9A - was not found ..."},
      {"code": "LABEL_MISMATCH", "severity": "major", "item": "K1",
       "expected": "K1", "actual": "K7", "message": "Expected label 'K1' but read 'K7' ..."}
    ],
    "components": [{"tag": "Q1", "type": "circuit_breaker", "status": "ok", "bbox": [..]}],
    "wire_labels": [{"label": "101", "status": "ok"}],
    "engines": {"vision": "opencv", "ocr": "tesseract"},
    "timings_ms": {"pdf": 18, "excel": 92, "vision": 10, "ocr": 4263, "report": 1321}
  },
  "links": {"report_pdf": "...", "annotated_image": "..."}
}
```
Errors are always JSON: `400 validation_error` (missing/wrong file),
`422 parse_error` (file unreadable – the inspection is saved as `failed`),
`503 service_unavailable` (Tesseract missing), `404 not_found`.

### Defect codes
| Code | Severity | Meaning |
|---|---|---|
| COMPONENT_MISSING | critical | Tag from the PDF not found in the photo |
| COMPONENT_TYPE_MISMATCH | critical | Tag sits on a device of the wrong type (YOLO) |
| COMPONENT_COUNT_SHORT | critical | Fewer devices of a type than the BOM (YOLO) |
| EXTRA_COMPONENT | major | More devices of a type than the BOM (YOLO) |
| LABEL_MISSING | major | Device present, its tag not readable (YOLO) |
| LABEL_MISMATCH | major | Near-identical label read (K1 → K7) |
| WIRE_LABEL_MISSING / _MISMATCH | major | Wire number from Excel not found / misread |
| UNEXPECTED_LABEL | minor | Tag in photo that no document mentions |

**FAIL** if any critical or major defect. Minor = warning only.

---

## Input file formats

**PDF** – a table with a tag column (`Tag`, `Ref`, `Designation`, `Device`…) and a
description column (`Description`, `Component`, `Type`…), optional `Qty`.
Ranges like `F1-F3` and lists `X1, X2` are expanded. Without a table, lines like
`K1  Contactor 24VDC` are used. Scanned image-only PDFs are not supported.

**Excel** (.xlsx/.xls/.csv) – any sheet with a header row (can be below title rows)
containing `Wire No` (or Wire / Ferrule / Label / Cable) and `From` / `To`.
`Colour` and `Size` are read too.

**Photo** – JPG/PNG, ideally ≥ 2000 px wide, straight on, labels in focus,
no glare on stickers.

---

## Making the vision step real AI (YOLO)

Out of the box the vision service uses an **OpenCV fallback**: it finds device
outlines but cannot tell a contactor from a relay, so component identity comes
from the OCR'd tags. For true component recognition:

1. `pip install ultralytics`
2. Label 150–300 photos of your cabinets in Roboflow / CVAT (export *YOLOv8*),
   classes like `circuit_breaker, contactor, relay, fuse, terminal_block, power_supply, plc`.
3. Edit `DATA_YAML` in `scripts/train_yolo.py`, run it (a GPU or Google Colab helps).
4. Copy `best.pt` to `models/cabinet_yolo.pt`, set `YOLO_MODEL_PATH=models/cabinet_yolo.pt` in `.env`.

`/api/health` then shows `"backend": "yolo"`, and the type-based rules
(TYPE_MISMATCH, COUNT_SHORT, EXTRA_COMPONENT, LABEL_MISSING) switch on automatically.

For blurry or angled photos, `pip install easyocr` and set `OCR_ENGINE=easyocr`.

---

## Project layout
```
app/
  __init__.py            app factory, CORS, blueprints
  config.py              all settings (.env)
  db.py                  SQLite tables + queries
  errors.py              JSON error handling
  routes/                health.py, inspections.py
  services/              pdf, excel, vision, ocr, rule_engine, report, inspection_pipeline
  utils/                 text.py (label normalising, OCR-confusion folding), files.py (upload checks)
scripts/                 make_samples.py, train_yolo.py
tests/                   test_rule_engine.py, test_api.py
run.py / serve.py        dev / production server
api.http                 ready-made requests
```

## Notes / limits
- Wiring is verified through wire-number labels. Proving that wire 101 really
  runs Q1:2 → K1:1 from one photo is not reliably possible; that needs close-up
  photos per terminal or a continuity test.
- Processing is synchronous (~5–15 s per photo). For many users at once, move
  `run_inspection` to a queue (Celery / RQ) and return `202` + poll the id.
- Switching SQLite → PostgreSQL only touches `app/db.py`.
