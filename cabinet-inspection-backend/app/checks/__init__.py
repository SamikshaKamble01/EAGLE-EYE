"""QC checks. Every module in this folder is imported automatically, so a new
check file registers itself - see app/checks/base.py for how to write one."""
import importlib
import pkgutil

from app.checks.base import (CheckContext, apply_to_result, compare, item, register,  # noqa: F401
                             registered, run_all, sheet_of)

for _module in pkgutil.iter_modules(__path__):
    if _module.name != "base":
        importlib.import_module(f"{__name__}.{_module.name}")
