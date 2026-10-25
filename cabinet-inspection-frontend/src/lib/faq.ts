// Help content: frequently asked questions, grouped by topic. Plain text only.
// An answer is a list of paragraphs; a paragraph starting with "- " is a bullet.
// Keep every statement true for the app as it is - this page is what users rely on when stuck.

export interface Faq {
  id: string; // stable, used in the page link (/help#why-missing)
  q: string;
  a: string[];
  links?: { label: string; to: string }[];
  keywords?: string; // extra words that should find this question
}

export interface FaqGroup {
  id: string;
  title: string;
  blurb: string;
  items: Faq[];
}

export const FAQ_GROUPS: FaqGroup[] = [
  {
    id: "start",
    title: "Getting started",
    blurb: "What to upload and what to expect.",
    items: [
      {
        id: "what-is-it",
        q: "What does Eagle-Eye do?",
        a: [
          "It compares what the approved drawing says should be in a cabinet with what your photos show, and lists every difference on a QC check sheet.",
          "- Missing or wrong devices, and labels that are missing, wrong or unreadable.",
          "- Wire sleeves (ferrules) and wire colours, when you give a wire list.",
          "- For every failed row: a zoomed proof picture and how to fix it.",
          "- A Root cause panel that shows what a missing part means for the circuits.",
        ],
        links: [{ label: "Start an inspection", to: "/inspect" }],
        keywords: "purpose overview about",
      },
      {
        id: "what-to-upload",
        q: "Which files do I need to upload?",
        a: [
          "- Drawing (required): a PDF. Either a parts table (Tag and Description columns) or a full drawing set with nameplate, general-arrangement and bill-of-material sheets.",
          "- Photos (required): one or more JPG or PNG pictures of the cabinet, up to 10.",
          "- Wire list (optional): an Excel file. Without it there are no ferrule or wire-colour rows; devices and labels are still checked.",
        ],
        keywords: "pdf excel jpg png files formats upload",
      },
      {
        id: "how-long",
        q: "How long does an inspection take?",
        a: [
          "One photo and a small drawing usually take under a minute. A full drawing set with several large photos can take one to three minutes or more.",
          "Drawings are remembered, so a re-check of the same drawing is much faster. Do not close the page while it is analysing.",
        ],
        keywords: "slow speed time wait loading",
      },
      {
        id: "several-photos",
        q: "Can I upload several photos of one cabinet?",
        a: [
          "Yes, up to 10: front, rear, sides and close-ups. Every result remembers which photo it came from, and the viewer shows a tab per photo.",
          "A side of the cabinet that no photo shows is reported as Not photographed (a note), not as missing. See the question about Not photographed below.",
        ],
        keywords: "multiple views front rear left right top bottom",
      },
      {
        id: "photo-tips",
        q: "How should I take the photos?",
        a: [
          "- Stand square to the panel and keep it sharp; avoid glare on labels.",
          "- Fill the frame with the area you want checked. Labels must be readable when you zoom in.",
          "- Several closer photos work better than one far-away photo.",
          "- Sideways labels are fine. Very small or blurred labels cannot be read.",
          "- Do not use photos smaller than 200 px or larger than about 80 megapixels.",
        ],
        keywords: "camera quality blur lighting labels unreadable",
      },
    ],
  },
  {
    id: "results",
    title: "Understanding results",
    blurb: "What the verdict, score and statuses mean.",
    items: [
      {
        id: "verdict-score",
        q: "What do PASS, FAIL and the score mean?",
        a: [
          "The score is the share of check-sheet rows that passed. Notes (WARN rows) do not count for or against it.",
          "The verdict is FAIL when at least one critical or major problem is open, otherwise PASS.",
        ],
        keywords: "percentage pass fail verdict",
      },
      {
        id: "not-photographed",
        q: "What is the difference between Not photographed and Missing?",
        a: [
          "- Missing: the place is in your photos, but the device or its label was not found there.",
          "- Not photographed: no photo shows that side or area, so the device could not be checked. It is a note, not a failure, and it is not counted as missing.",
          "To resolve Not photographed items, take a photo of that side and run a re-check.",
        ],
        keywords: "unseen coverage grey",
      },
      {
        id: "why-missing",
        q: "It says a part is missing, but it is there. Why?",
        a: [
          "Parts are found mostly by reading their labels. A label that is hidden, too small, blurred or turned away looks the same as a missing part.",
          "- Take a closer, sharper photo and run a re-check.",
          "- If a person has looked at the cabinet, record it in the Root cause panel under Inspector observation: choose Component is present. The analysis updates and the change is saved.",
        ],
        links: [{ label: "Open the history", to: "/history" }],
        keywords: "false alarm wrong not found ocr",
      },
      {
        id: "check-sheet",
        q: "What are the QC check sheet, proof pictures and the Excel file?",
        a: [
          "The check sheet lists every check as a numbered row (PASS, FAIL or WARN). Each failed row has a zoomed proof picture and a How to fix it line.",
          "Download the sheet as Excel from the inspection page; it includes a Proof sheet and the fix instructions.",
        ],
        keywords: "xlsx report pdf download export proof snippet",
      },
      {
        id: "recheck",
        q: "How do I check that a fix worked?",
        a: [
          "Fix the cabinet, photograph it again, and use Re-check on the inspection page (or upload in the 3D view). The new result shows which problems are closed, still open or new, and the history keeps every round.",
        ],
        keywords: "retest fix again second round",
      },
      {
        id: "drawing-comparison",
        q: "What is Drawing comparison?",
        a: [
          "If an uploaded picture is a screenshot, scan or print of a drawing sheet (not a photo of a real cabinet), it is lined up with the PDF and compared. Small differences such as a changed digit, a moved label or a removed symbol get a box and a row on the check sheet.",
          "Photos of real cabinets are not compared this way; the step recognises them and skips them.",
        ],
        keywords: "diff screenshot difference minute changes",
      },
    ],
  },
  {
    id: "root-cause",
    title: "Root cause and fault impact",
    blurb: "What a missing part or label means for the circuits.",
    items: [
      {
        id: "root-cause-panel",
        q: "What is the Root cause and fault impact panel?",
        a: [
          "For every missing or wrongly installed part it follows the documented connections: part, circuit, dependent parts, subsystem, cabinet. It also separates electrical defects from labelling defects and from items that could not be verified.",
          "Click a part in the graph to follow what feeds it and what it feeds; click a defect to see only its effect.",
        ],
        keywords: "dependency graph consequence chain",
      },
      {
        id: "impact-terms",
        q: "What do Supply lost, Redundancy lost and Impact unknown mean?",
        a: [
          "- Supply lost: no other documented supply path is left for that part.",
          "- Redundancy lost: the part still has a second documented feed, so it should keep working, but only on one feed.",
          "- Impact unknown: the drawings do not show enough to say what happens.",
          "A part that is only downstream of a fault is reported as affected, not as defective.",
        ],
        keywords: "probable confirmed redundancy",
      },
      {
        id: "disposition",
        q: "What do the overall results mean (PASS, PASS WITH DOCUMENTATION DEFECTS, FAIL, HOLD)?",
        a: [
          "- PASS: all checks that could be made are satisfied.",
          "- PASS WITH DOCUMENTATION DEFECTS: only label or identification problems remain, and the policy allows that.",
          "- FAIL: a required part is missing or wrongly installed.",
          "- HOLD FOR ENGINEERING REVIEW: the evidence is not enough, or an identification problem on a protective device needs a decision.",
          "The rules behind these are default settings, not an approved project policy, and the panel says so.",
        ],
        keywords: "disposition hold engineering approval policy",
      },
      {
        id: "probable",
        q: "Why is the impact called probable and not confirmed?",
        a: [
          "Consequences are worked out from the drawing's connections. Nothing is tested or measured, so they are probable. Only a fact seen directly, such as a part an inspector confirmed missing, is treated as established.",
        ],
        keywords: "tested measured",
      },
      {
        id: "missing-label",
        q: "Does a missing label mean a circuit is open?",
        a: [
          "No. A missing or wrong label is an identification defect: it makes maintenance riskier and wire checks less reliable, but it does not show that anything is disconnected. A missing wire label is never treated as a broken wire.",
        ],
        keywords: "wire label ferrule identification",
      },
      {
        id: "observation",
        q: "What is an Inspector observation?",
        a: [
          "A way to record what a person saw: the component is present, missing or cannot be verified, and the label is present, missing, wrong or unreadable. An observation beats what the photos suggest. The analysis is recalculated and saved with the inspection.",
        ],
        keywords: "manual override confirm",
      },
      {
        id: "not-on-schematic",
        q: "Why does it say parts are not on the documented schematic sheets?",
        a: [
          "The connections must be written into a topology file from the drawing. Today only cabinet 13SP04331 has one. For other cabinets, or parts that are not drawn on the schematic sheets, the impact is shown as unknown instead of guessed.",
        ],
        keywords: "topology unknown 13SP04331",
      },
      {
        id: "safe",
        q: "Does a PASS mean the cabinet is electrically safe?",
        a: [
          "No. The inspection compares photos and drawings. It does not measure wiring, test functions or prove that connections are correct. Safety sign-off needs the project's own tests and acceptance criteria.",
        ],
        keywords: "safety certification",
      },
    ],
  },
  {
    id: "3d",
    title: "3D cabinet view",
    blurb: "Using the interactive cabinet.",
    items: [
      {
        id: "use-3d",
        q: "How do I use the 3D view?",
        a: [
          "- Drag to rotate, right-drag to pan, scroll to zoom.",
          "- Click a device to see its tag, name, place and status; click empty space to deselect.",
          "- Use Open door / Close door, Regions and Reset view; full screen is the corner button.",
          "- You can upload photos or use the camera from inside the 3D view to run an inspection or re-check.",
        ],
        keywords: "rotate zoom pan door camera reset",
      },
      {
        id: "3d-accuracy",
        q: "Are the device positions in the 3D view exact?",
        a: [
          "No. The cabinet is built from simple geometry and devices are grouped by type on DIN rails, so positions and regions R1 to R4 are illustrative. The statuses on the devices, however, come from the real check sheet.",
        ],
        keywords: "illustrative regions layout verified",
      },
      {
        id: "3d-colours",
        q: "What do the colours and outlines mean?",
        a: [
          "- Green strip: passed. Red: failed. Amber: a note.",
          "- Red ghost box: not found in the photos. Grey ghost: not photographed.",
          "- Orange, yellow or purple outline: affected by a fault elsewhere (supply lost, redundancy lost, impact unknown); blue: label defect.",
        ],
        keywords: "legend status colour",
      },
    ],
  },
  {
    id: "trouble",
    title: "Troubleshooting",
    blurb: "When something does not work.",
    items: [
      {
        id: "backend-offline",
        q: "It says it cannot reach the backend.",
        a: [
          "The backend is a separate program that must be running. Open a terminal in the cabinet-inspection-backend folder and run: python run.py (it listens on port 5000). Then reload the page.",
          "Use System check on this page to see which service is down.",
        ],
        keywords: "network error offline 5000 flask server not working",
      },
      {
        id: "upload-refused",
        q: "My upload was refused. What can I check?",
        a: [
          "- Cabinet name: letters, numbers, spaces and the characters - _ . / # ( ) only, up to 120 characters. A comma is not allowed.",
          "- Photos must be real JPG or PNG images, at least 200 px, not above about 80 megapixels.",
          "- The drawing must be a readable PDF with a parts table or a drawing set. Scanned image-only PDFs need OCR first.",
        ],
        keywords: "error 400 invalid characters comma file type too large small",
      },
      {
        id: "labels-misread",
        q: "Labels are read wrongly or not at all.",
        a: [
          "Take closer and sharper photos with even light, and avoid reflections. Several photos of the same area help. If a person verified the part, record an Inspector observation.",
        ],
        keywords: "ocr text wrong characters",
      },
      {
        id: "delete-data",
        q: "Where is my data stored, and how do I delete it?",
        a: [
          "Everything stays on the computer that runs the backend (its storage folder). Open an inspection and choose Delete record, or use Delete all in the History page.",
        ],
        links: [{ label: "Open the history", to: "/history" }],
        keywords: "privacy remove storage history",
      },
    ],
  },
];

export const ALL_FAQS: (Faq & { group: string })[] = FAQ_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.id })));

/** Questions that match every word of the search text (question, answer and keywords). */
export function searchFaqs(text: string): typeof ALL_FAQS {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return ALL_FAQS;
  return ALL_FAQS.filter((f) => {
    const hay = `${f.q} ${f.a.join(" ")} ${f.keywords ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
