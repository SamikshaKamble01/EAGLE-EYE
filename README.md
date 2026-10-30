⚡ AI-Powered Electrical Cabinet Inspection System

An AI-assisted industrial inspection platform that automates the verification of electrical components inside control cabinets by combining Computer Vision, OCR, Electrical Drawing Analysis, Automated Verification, and 3D Visualization.

🚀 Overview

Manual electrical cabinet inspection can be time-consuming and error-prone. Engineers often need to compare cabinet photographs with electrical drawings, verify component labels, and identify missing or unverified devices.

Our system aims to simplify this process by connecting real-world cabinet images with expected components from electrical drawings and generating a structured inspection report.

✨ Key Features

- 🤖 AI Component Detection — Detects electrical components using YOLO-based computer vision.
- 🔤 OCR Label Recognition — Extracts component labels from cabinet photographs using Tesseract OCR.
- 📐 Electrical Drawing Analysis — Extracts expected device tags and information from electrical drawings.
- ✅ Automated Verification — Compares detected components with expected components.
- 📸 Photo Coverage Analysis — Tracks photographed and unphotographed cabinet sides.
- 🧊 3D Cabinet Visualization — Provides a 3D representation for better inspection and understanding.
- 📊 Inspection Reports — Generates structured inspection results and findings.
- 🗂️ Inspection History — Stores previous inspection results for future reference.

🏗️ System Workflow

Electrical Drawing
        ↓
Expected Components
        ↓
Cabinet Photographs
        ↓
Image Processing
        ↓
YOLO + OCR Detection
        ↓
Component Verification
        ↓
Coverage Analysis
        ↓
Inspection Results
        ↓
Report Generation

🧠 Technology Stack

Component| Technology
Frontend| React + Vite
Backend| Python
Computer Vision| OpenCV
Object Detection| YOLO
OCR| Tesseract
Drawing Analysis| Python-based Parser
Verification| Rule-Based Inspection Engine
Visualization| 3D Cabinet Model

📊 Prototype

The prototype was evaluated using multiple cabinet photographs and generated an automated inspection report containing:

- Detected component labels
- Expected components
- Verified components
- Components requiring further verification
- Unphotographed components
- Overall inspection compliance

🎯 Objective

The primary objective is to transform electrical cabinet inspection from a largely manual process into a structured, AI-assisted and traceable workflow, helping engineers identify areas requiring further inspection more efficiently.

🔮 Future Scope

- Custom YOLO model trained specifically on electrical cabinet components
- Improved small-label and low-quality image recognition
- Support for larger and more complex cabinet layouts
- Multi-angle and 3D cabinet inspection
- Real-time component detection
- Improved drawing-to-image mapping
- Advanced inspection analytics

🏆 Hackathon

This project was developed for the Emerson Challenge at VIT CODE APEX 3.0, where our team Infinite Looper progressed to the Final Immersion Round among the Top 20 teams.

👥 Team

Infinite Looper

Built with collaboration, curiosity and a passion for solving real-world engineering problems. 🚀

---

📌 Note

This project is a prototype developed for educational and hackathon purposes. Detection accuracy can be improved further with a dedicated dataset and custom-trained models.
