"""Flask application factory."""
import logging

from flask import Flask, jsonify, request

from app.config import Config


def _setup_cors(app: Flask):
    """Small built-in CORS handler so the frontend (React/Vite etc.) can call the API."""
    origins = app.config["CORS_ORIGINS"]

    @app.after_request
    def add_cors_headers(response):
        origin = request.headers.get("Origin")
        if origin and ("*" in origins or origin in origins):
            response.headers["Access-Control-Allow-Origin"] = "*" if "*" in origins else origin
            response.headers["Vary"] = "Origin"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
            response.headers["Access-Control-Expose-Headers"] = "Content-Disposition"
        return response

    @app.before_request
    def preflight():
        if request.method == "OPTIONS":
            return app.make_default_options_response()


def create_app(config_class=Config) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_class)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    app.config["STORAGE_DIR"].mkdir(parents=True, exist_ok=True)

    from app import db
    from app.errors import register_error_handlers
    from app.routes import health, inspections

    db.init_db(app)
    register_error_handlers(app)
    _setup_cors(app)
    app.register_blueprint(health.bp)
    app.register_blueprint(inspections.bp)

    @app.get("/")
    def index():
        return jsonify({"service": "cabinet-inspection-api", "docs": "/api/health"})

    return app
