"""Klarnamen fuer Drop-Inhalte und neue Fahrzeuge."""
import pytest

from pubg.aggregations import _item_label, _VEHICLE_PATTERNS


@pytest.mark.parametrize("item,label", [
    ("Item_Weapon_L6_C", "Lynx AMR"),
    ("Item_Weapon_FAMASG2_C", "FAMAS"),
    ("Item_Weapon_DP12_C", "DBS"),
    ("Item_Weapon_P90_C", "P90"),
    ("Item_Weapon_Pickaxe_C", "Pickaxe"),
    ("Item_Weapon_StickyGrenade_C", "Sticky Bomb"),
    ("Item_Weapon_PanzerFaust100M_C", "Panzerfaust"),
    ("Item_JerryCan_C", "Jerry Can"),
    ("Item_SpareTire_C", "Spare Tire"),
    ("Item_Attach_Weapon_Stock_AR_HeavyStock_C", "Heavy Stock"),
    ("Item_Attach_Weapon_Muzzle_AR_MuzzleBrake_C", "Muzzle Brake"),
    ("Item_Attach_Weapon_Muzzle_Compensator_Large_C", "Compensator"),
    ("Item_Weapon_PackageFlare_nonDest_C", "Package Flare"),
    ("Item_Weapon_PackageFlare_summerland_C", "Package Flare"),
])
def test_drop_item_hat_einen_klarnamen(item, label):
    assert _item_label(item) == label


def _fahrzeug(vid):
    return next((l for n, l in _VEHICLE_PATTERNS if n in vid), None)


@pytest.mark.parametrize("vid,label", [
    ("BP_FlyingSpur_LGD_C", "Bentley Flying Spur"),
    ("BP_FlyingSpur_ULT_C", "Bentley Flying Spur"),
    ("BP_ContinentalGTC_LGD_C", "Bentley Continental GTC"),
])
def test_bentleys_werden_erkannt(vid, label):
    assert _fahrzeug(vid) == label
