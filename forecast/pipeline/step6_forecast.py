"""
STEP 6 - Avalanche alert forecast (analysis PC)
================================================
Thin wrapper around run_forecast.py so the old commands keep working:

  python step6_forecast.py "C:\\...\\processed"                      live forecast
  python step6_forecast.py "C:\\...\\processed" --replay 2005-02-08  replay from ERA5
  python step6_forecast.py "C:\\...\\processed" --check              API check

Needs forecast_core.py and run_forecast.py in the same folder.
Outputs go to processed\\forecast\\run_<date>\\ or processed\\forecast\\replay_<date>\\
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from run_forecast import main  # noqa: E402

if __name__ == "__main__":
    main()
