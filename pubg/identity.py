"""Ein Spieler, mehrere PUBG-Accounts.

Wer zwischen zwei Steam-Accounts wechselt, hat zwei PUBG-Accounts mit
eigener Account-ID — ist aber derselbe Mensch. `SelfAccounts` steht an
allen Stellen, an denen bisher die eine eigene Account-ID stand:

* SQL: `core.db_compat` macht aus `account_id = ?` ein `= ANY(...)` und
  aus `<> ?` ein `<> ALL(...)`, sobald der Parameter ein SelfAccounts ist.
* Python: `acc == me` / `acc != me` pruefen die Mitgliedschaft. Fuer
  Dict-Zugriffe gibt es `pick_me` — Hash-Lookups kann der Typ nicht
  umbiegen.

In einem Match spielt der Mensch nur mit EINEM der Accounts, deshalb
liefern Abfragen je Match weiterhin genau eine eigene Zeile.
"""


class SelfAccounts(tuple):
    """Alle Account-IDs eines Spielers, die primaere zuerst."""

    def __new__(cls, ids):
        seen = []
        for a in ids:
            if a and a not in seen:
                seen.append(a)
        if not seen:
            raise ValueError("SelfAccounts braucht mindestens eine Account-ID")
        return super().__new__(cls, seen)

    @property
    def primary(self) -> str:
        return self[0]

    # Ein String vergleicht sich mit der Menge ueber Mitgliedschaft. Python
    # fragt bei `"acc" == me` zuerst die Unterklasse — beide Richtungen
    # funktionieren also ohne Umbau der Aufrufer.
    def __eq__(self, other):
        if isinstance(other, str):
            return other in tuple(self)
        return tuple.__eq__(self, other)

    def __ne__(self, other):
        eq = self.__eq__(other)
        return eq if eq is NotImplemented else not eq

    __hash__ = tuple.__hash__

    def __str__(self):
        return "|".join(self)


def as_set(me) -> set:
    """Eigene Account-IDs als Menge — fuer Ausschluss-Listen."""
    if me is None:
        return set()
    if isinstance(me, SelfAccounts):
        return set(me)
    return {me}


def pick_me(mapping: dict, me, default=None):
    """`mapping.get(me)` fuer einen oder mehrere eigene Accounts.

    Bei mehreren gewinnt der erste vorhandene in Reihenfolge der Menge —
    je Match gibt es ohnehin nur einen.
    """
    if me is None:
        return default
    if isinstance(me, SelfAccounts):
        for a in me:
            if a in mapping:
                return mapping[a]
        return default
    return mapping.get(me, default)
