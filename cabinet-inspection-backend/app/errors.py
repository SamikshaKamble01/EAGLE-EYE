"""Custom exceptions + JSON error handlers (the frontend always gets JSON)."""
import logging

from flask import jsonify
from werkzeug.exceptions import HTTPException

log = logging.getLogger(__name__)


class AppError(Exception):
    status_code = 500
    error = "internal_error"

    def __init__(self, message: str, details=None):
        super().__init__(message)
        self.message = message
        self.details = details


class ValidationError(AppError):
    status_code = 400
    error = "validation_error"


class ParseError(AppError):
    """An input file could be opened but its content could not be understood."""
    status_code = 422
    error = "parse_error"


class ServiceUnavailable(AppError):
    """A required engine (OCR / vision) is not installed or configured."""
    status_code = 503
    error = "service_unavailable"


class NotFound(AppError):
    status_code = 404
    error = "not_found"


def register_error_handlers(app):
    @app.errorhandler(AppError)
    def handle_app_error(exc: AppError):
        body = {"error": exc.error, "message": exc.message}
        if exc.details is not None:
            body["details"] = exc.details
        return jsonify(body), exc.status_code

    @app.errorhandler(HTTPException)
    def handle_http_error(exc: HTTPException):
        return jsonify({"error": exc.name.lower().replace(" ", "_"), "message": exc.description}), exc.code

    @app.errorhandler(Exception)
    def handle_unexpected(exc: Exception):
        log.exception("Unhandled error")
        return jsonify({"error": "internal_error", "message": "Unexpected server error."}), 500
