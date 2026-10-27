"""Portal configuration. All secrets come from environment variables (.env), never from source."""
import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:  # python-dotenv is optional
    pass

BASE_DIR = Path(__file__).resolve().parent


class Config:
    PORTAL_TITLE = "SNOW AVALANCHE PREDICTION USING AI"
    PORTAL_VERSION = "1.0.0"

    # Public Mapbox browser token (pk.*). Restrict it to your domains in the Mapbox account.
    MAPBOX_TOKEN = os.getenv("MAPBOX_TOKEN", "").strip()

    DATA_DIR = Path(os.getenv("PORTAL_DATA_DIR", BASE_DIR / "data"))
    MODEL_DIR = Path(os.getenv("PORTAL_MODEL_DIR", BASE_DIR / "model"))
    PREDICTIONS_DIR = DATA_DIR / "predictions"

    # Datasets older than this many hours are flagged as stale in the UI.
    STALE_AFTER_HOURS = int(os.getenv("STALE_AFTER_HOURS", "48"))

    # Season convention: 15 Dec -> 15 Apr (end date exclusive => last day shown is 14 Apr).
    SEASON_START_MMDD = (12, 15)
    SEASON_END_MMDD = (4, 15)
    WINDOW_DAYS = 15

    SECRET_KEY = os.getenv("SECRET_KEY", os.urandom(24).hex())
    DEBUG = os.getenv("FLASK_DEBUG", "0") == "1"
    HOST = os.getenv("HOST", "127.0.0.1")
    PORT = int(os.getenv("PORT", "5000"))
