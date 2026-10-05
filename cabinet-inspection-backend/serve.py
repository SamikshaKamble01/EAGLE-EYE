"""Production server (works on Windows, Linux and Mac):  python serve.py

Linux alternative:  gunicorn -w 2 -b 0.0.0.0:5000 --timeout 180 "app:create_app()"
"""
import os

from waitress import serve

from app import create_app

if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    print(f"Serving on http://0.0.0.0:{port}")
    # OCR on a big photo can take several seconds - keep a few worker threads
    serve(create_app(), host="0.0.0.0", port=port, threads=4, channel_timeout=180)
