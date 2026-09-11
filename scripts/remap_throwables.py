#!/usr/bin/env python3
"""Wurfgeraete in `match_weapon_stats` auf die gemappten Namen ziehen.

**Warum.** Vier Wurfgeraete tragen `Item_Weapon_`-Praefix statt `Proj`
und fehlten deshalb in WEAPON_NAMES: Rauchbombe, Blendgranate, Taser und
Blauzonen-Granate. Ihre Zeilen liegen unter der rohen Kurz-Id
(`SmokeBomb`, `FlashBang`, `StunGun`, `BluezoneGrenade`), zaehlen als
Klasse "other" und haben `is_thrown = false` — damit tauchten sie in
keiner Wurf-Wertung auf, obwohl die Rauchbombe mit 1.560 Wuerfen das
meistgeworfene Geraet ueberhaupt ist.

**Die Blauzonen-Granate ist dabei zweifach falsch.** Unter ihrem eigenen
Namen stehen nur die Wuerfe; Schaden und Toetung laufen ueber den
Effekt-Aktor `Bluezonebomb_EffectActor_C`, und der war als "Red Zone"
beschriftet. Eigene Granaten-Kills landeten so in der Umgebungs-Spalte
statt bei der Waffe — 302 Kills ueber alle Tenants, bei null Wuerfen in
derselben Zeile. Dieselbe Trennung wie beim Molotov, wo das Feuer toetet
und nicht der Aufschlag.

**Warum kein Re-Backfill.** `upsert_weapon_stats` ersetzt den kompletten
Satz eines Matches und wuerde beim Neuberechnen alles richtigstellen —
aber nur fuer Matches mit vorliegender Telemetrie. Die Lobby-Referenz
umfasst 23.000 Spieler, deren Zeilen ueber Monate gewachsen sind; fuer
die gibt es keine Rohdaten mehr. Deshalb hier ein Merge in SQL.

**Zusammenlegen, nicht umbenennen.** Ein Match hat oft beide Zeilen —
die Wuerfe unter `BluezoneGrenade`, die Kills unter `Red Zone`. Ein
reines UPDATE liefe in den Primaerschluessel; die Zaehler muessen
addiert werden.

    python3 scripts/remap_throwables.py --dry-run
    python3 scripts/remap_throwables.py --apply
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import db as core_db                               # noqa: E402
from pubg.db_pg import _MWS_COLS                             # noqa: E402

#: Quellname → Zielname. Rechts steht, was WEAPON_NAMES jetzt liefert.
RENAMES = {
    "SmokeBomb": "Rauchbombe",
    "FlashBang": "Blendgranate",
    "StunGun": "Taser",
    "StunGrenade": "Taser",
    "BluezoneGrenade": "Blauzonen-Granate",
    # Der Effekt-Aktor der geworfenen Granate, nicht die Zonen-
    # Bombardierung: die heisst RedZoneBombingField_* und steht gar
    # nicht in match_weapon_stats, weil sie keine Waffe ist. Ein
    # Spieler kann mit der echten Red Zone niemanden toeten, also sind
    # alle Kills unter diesem Namen Granaten-Kills.
    "Red Zone": "Blauzonen-Granate",
}

#: Spalten, die beim Zusammenlegen addiert werden. Alles aus _MWS_COLS
#: ausser dem Schluessel und den beschreibenden Feldern.
_DESCRIPTIVE = ("account_id", "player_name", "team_id", "is_bot", "weapon",
                "is_thrown")
SUM_COLS = tuple(c for c in _MWS_COLS if c not in _DESCRIPTIVE)

#: Alle Namen, deren `is_thrown` auf true gehoert. Die Spalte wurde erst
#: ab August 2026 mitgeschrieben; aeltere Zeilen stehen auf false,
#: obwohl der Wert eine reine Funktion des Namens ist.
def _throwable_names():
    from pubg.weapon_milestones import THROWABLES
    return list(THROWABLES)


def counts(cur):
    cur.execute("""
        SELECT weapon, COUNT(*) AS n, SUM(shots) AS shots, SUM(kills) AS kills
        FROM match_weapon_stats WHERE weapon = ANY(%s)
        GROUP BY weapon ORDER BY COUNT(*) DESC
    """, (list(RENAMES),))
    return cur.fetchall()


def merge(cur, dry_run=True):
    """Quellzeilen auf den Zielnamen addieren und dann loeschen."""
    sums = ", ".join(f"SUM(s.{c}) AS {c}" for c in SUM_COLS)
    adds = ", ".join(f"{c} = match_weapon_stats.{c} + EXCLUDED.{c}"
                     for c in SUM_COLS)
    cols = ", ".join(SUM_COLS)
    moved = 0
    for src, dst in RENAMES.items():
        # Erst die Summen je Zielschluessel bilden, dann einfuegen oder
        # auf eine bestehende Zielzeile addieren. Der Zielname kann in
        # demselben Match schon stehen — genau das ist der Fall, den ein
        # reines UPDATE nicht loesen kann.
        cur.execute(f"""
            INSERT INTO match_weapon_stats
                   (tenant_id, match_id, account_id, weapon,
                    player_name, team_id, is_bot, is_thrown, {cols})
            SELECT s.tenant_id, s.match_id, s.account_id, %s,
                   MIN(s.player_name), MIN(s.team_id), BOOL_OR(s.is_bot),
                   TRUE, {sums}
            FROM match_weapon_stats s
            WHERE s.weapon = %s
            GROUP BY s.tenant_id, s.match_id, s.account_id
            ON CONFLICT (tenant_id, match_id, account_id, weapon)
            DO UPDATE SET {adds}, is_thrown = TRUE
        """, (dst, src))
        n = cur.rowcount or 0
        cur.execute("DELETE FROM match_weapon_stats WHERE weapon = %s",
                    (src,))
        d = cur.rowcount or 0
        moved += d
        print(f"  {src:18s} -> {dst:20s} {d:6d} Zeilen zusammengelegt "
              f"({n} Zielzeilen)")
    return moved


def fix_is_thrown(cur):
    cur.execute("""
        UPDATE match_weapon_stats SET is_thrown = TRUE
        WHERE NOT is_thrown AND weapon = ANY(%s)
    """, (_throwable_names(),))
    return cur.rowcount or 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true",
                    help="schreiben (ohne das nur zaehlen)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    if not args.apply:
        print("Probelauf — nichts wird geschrieben. Mit --apply anwenden.\n")

    conn = core_db.connect()
    with conn.cursor() as cur:
        print("Vorher:")
        for r in counts(cur):
            print(f"  {r['weapon']:18s} {r['n']:6d} Zeilen, "
                  f"{r['shots'] or 0:6d} Wuerfe, {r['kills'] or 0:5d} Kills")
        cur.execute("SELECT COUNT(*) AS n FROM match_weapon_stats "
                    "WHERE NOT is_thrown AND weapon = ANY(%s)",
                    (_throwable_names(),))
        print(f"\n  Wurf-Zeilen mit falschem is_thrown: "
              f"{cur.fetchone()['n']}")
        if not args.apply:
            conn.rollback()
            return 0
        print("\nZusammenlegen:")
        moved = merge(cur)
        fixed = fix_is_thrown(cur)
        print(f"\n  is_thrown korrigiert: {fixed} Zeilen")
        conn.commit()
        print("\nNachher:")
        cur.execute("""
            SELECT weapon, COUNT(*) AS n, SUM(shots) AS shots,
                   SUM(kills) AS kills, SUM(damage)::int AS damage
            FROM match_weapon_stats WHERE weapon = ANY(%s)
            GROUP BY weapon ORDER BY SUM(shots) DESC NULLS LAST
        """, (_throwable_names(),))
        for r in cur.fetchall():
            print(f"  {r['weapon']:20s} {r['n']:6d} Zeilen, "
                  f"{r['shots'] or 0:7d} Wuerfe, {r['kills'] or 0:5d} Kills, "
                  f"{r['damage'] or 0:8d} Schaden")
        print(f"\nfertig: {moved} Zeilen zusammengelegt, {fixed} korrigiert")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
