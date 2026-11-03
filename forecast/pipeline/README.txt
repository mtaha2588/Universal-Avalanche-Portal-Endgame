SNOW AVALANCHE THRESHOLDS - ERA5 NORTHERN PAKISTAN
==================================================

0. Install once (Command Prompt / Anaconda Prompt):
      pip install pandas numpy matplotlib pyarrow

1. Put all ERA5_NPak_daily_*.csv files in one folder, e.g. D:\ERA5_NPak
   (multi-year files like 1970_1974 and "Copy of ..." names are fine;
    overlaps and duplicate days are removed automatically.)

2. Clean + build drivers  (~10-15 s per year of data):
      python step1_prepare_era5.py "D:\ERA5_NPak" "D:\ERA5_NPak\processed"
   -> processed\features\  one feature file per input file
   -> processed\tiles.csv  elevation (approx.) + glacier / perennial-snow flag
   -> processed\qc_report.txt  date gaps, missing tiles, flagged tiles
   CHECK qc_report.txt: it will list GAPs (e.g. 2011-2026 if not added yet).

3. Event vs climatology + thresholds:
      python step2_event_thresholds.py "D:\ERA5_NPak\processed" avalanche_events_master.csv
   -> processed\thresholds\event_driver_percentiles.csv
   -> processed\thresholds\driver_thresholds.csv
   -> processed\thresholds\event_<id>.png   (15 days before each avalanche)

How to read the results
  *_pctile = how unusual a driver was before the avalanche compared with the
  same place's winter climatology (99 = only 1% of winter days were higher).
  A driver that is high-percentile for MOST events is a trigger; its event
  values give the threshold. AUC (0.5 = useless, 1 = perfect) ranks drivers,
  but only trust it with ~15+ events.

avalanche_events_master.csv
  Seed list from open sources. Coordinates marked approx_* MUST be checked on
  Google Earth / maps before final analysis. Add more rows in the same format
  (newspaper archives, NDMA/PDMA sitreps, ReliefWeb). Only events up to the last
  year of your ERA5 files are analysed; the rest are reported as "no data yet".
