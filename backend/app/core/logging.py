import json
import logging


def setup_logging(level: str = "INFO") -> None:
    logging.basicConfig(level=getattr(logging, level.upper(), logging.INFO), format="%(message)s")
    logging.getLogger().setLevel(getattr(logging, level.upper(), logging.INFO))


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)


def dumps_log(payload: dict) -> str:
    return json.dumps(payload, default=str, sort_keys=True)
