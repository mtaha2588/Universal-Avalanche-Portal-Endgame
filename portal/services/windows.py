"""Seasonal 15-day reporting windows.

Convention
----------
* A season runs from 15 Dec (year Y) to 15 Apr (year Y+1).
* Windows are half-open intervals [start, end): `end` is NOT part of the window.
* Consecutive windows share a boundary date only as one window's (exclusive) end and the
  next window's (inclusive) start, so no date belongs to two windows.
* The final window is truncated at the season end and may be shorter than 15 days.

These are REPORTING windows. They say nothing about forecast lead time.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import date, timedelta


@dataclass(frozen=True)
class Window:
    index: int
    start: date          # inclusive
    end: date            # exclusive
    season: str

    @property
    def days(self) -> int:
        return (self.end - self.start).days

    @property
    def last_day(self) -> date:
        return self.end - timedelta(days=1)

    def contains(self, d: date) -> bool:
        return self.start <= d < self.end

    @property
    def id(self) -> str:
        return f"{self.season}-W{self.index:02d}"

    def to_dict(self) -> dict:
        d = asdict(self)
        d.update(
            id=self.id,
            start=self.start.isoformat(),
            end_exclusive=self.end.isoformat(),
            last_day=self.last_day.isoformat(),
            days=self.days,
            label=f"{self.start:%d %b} – {self.last_day:%d %b %Y}",
        )
        d.pop("end")
        return d


def season_bounds(start_year: int, start_mmdd=(12, 15), end_mmdd=(4, 15)) -> tuple[date, date]:
    start = date(start_year, *start_mmdd)
    end = date(start_year + 1, *end_mmdd)
    return start, end


def season_label(start_year: int) -> str:
    return f"{start_year}-{(start_year + 1) % 100:02d}"


def generate_windows(start_year: int, window_days: int = 15,
                     start_mmdd=(12, 15), end_mmdd=(4, 15)) -> list[Window]:
    if window_days < 1:
        raise ValueError("window_days must be >= 1")
    s, e = season_bounds(start_year, start_mmdd, end_mmdd)
    label = season_label(start_year)
    out, cur, i = [], s, 1
    while cur < e:
        nxt = min(cur + timedelta(days=window_days), e)
        out.append(Window(i, cur, nxt, label))
        cur, i = nxt, i + 1
    return out


def season_start_year_for(d: date, start_mmdd=(12, 15)) -> int:
    """Season a date is associated with (dates Apr 15 – Dec 14 map to the upcoming season)."""
    return d.year if (d.month, d.day) >= start_mmdd else d.year - 1


def window_for_date(d: date, window_days: int = 15) -> Window | None:
    for w in generate_windows(season_start_year_for(d), window_days):
        if w.contains(d):
            return w
    return None
