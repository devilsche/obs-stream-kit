from datetime import date
import pytest
from scripts import backup_pg


def test_pick_tier_sunday_first_of_month():
    # 2026-02-01 ist ein Sonntag UND der 1. des Monats → alle drei Tiers
    tiers = backup_pg.pick_tiers(date(2026, 2, 1))
    assert tiers == {"daily", "weekly", "monthly"}


def test_pick_tier_sunday_only():
    tiers = backup_pg.pick_tiers(date(2026, 5, 17))  # Sonntag, nicht 1.
    assert tiers == {"daily", "weekly"}


def test_pick_tier_first_of_month_only():
    tiers = backup_pg.pick_tiers(date(2026, 6, 1))  # Montag + 1.
    assert tiers == {"daily", "monthly"}


def test_pick_tier_normal_day():
    tiers = backup_pg.pick_tiers(date(2026, 5, 28))
    assert tiers == {"daily"}


def test_prune_keeps_n_newest():
    files = [
        "pg_dump_2026-05-28.dump.gz",
        "pg_dump_2026-05-27.dump.gz",
        "pg_dump_2026-05-26.dump.gz",
        "pg_dump_2026-05-25.dump.gz",
        "pg_dump_2026-05-24.dump.gz",
        "pg_dump_2026-05-23.dump.gz",
        "pg_dump_2026-05-22.dump.gz",
        "pg_dump_2026-05-21.dump.gz",  # zu alt
        "pg_dump_2026-05-20.dump.gz",  # zu alt
    ]
    to_delete = backup_pg.files_to_prune(files, keep=7)
    assert sorted(to_delete) == [
        "pg_dump_2026-05-20.dump.gz",
        "pg_dump_2026-05-21.dump.gz",
    ]
