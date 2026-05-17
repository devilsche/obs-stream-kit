"""Weapon-/Vehicle-Icons aus pubg.com/game-info/ — stabile Base-URLs.

pubg/api-assets ist seit ~2J. stagnant (JS9 etc. fehlen). pubg.com hat
unter https://wstatic-prod.pubg.com/web/live/static/game-info/... saubere
unskinned Default-Renderings aller Waffen + Vehicles unter VORHERSAGBAREN
URLs (kein Hash, kein Deploy-Reset wie auf der Item-Marketing-Seite).

Patterns:
  https://wstatic-prod.pubg.com/web/live/static/game-info/weapons/images/
    viewer/img-weapons-<slug>.webp
  https://wstatic-prod.pubg.com/web/live/static/game-info/vehicles/images/
    viewer/img-vehicles-<slug>.webp

Das Mapping <slug> -> Class-Name (z.B. 'akm' -> 'WeapAK47_C') ist hier
hardgecoded.
"""

import urllib.request
import urllib.error

CDN_BASE = "https://wstatic-prod.pubg.com/web/live/static/game-info"
UA = "Mozilla/5.0 obs-stream-kit/1.0"


# pubg.com Slug -> Telemetrie-Class-Name (siehe widgets/pubg/assets/weapons/)
WEAPON_SLUG_TO_CLASS = {
    "ace32":        "WeapACE32_C",
    "akm":          "WeapAK47_C",       # AKM in Spiel == WeapAK47_C in Telem
    "aug_a3":       "WeapAUG_C",
    "awm":          "WeapAWM_C",
    "beryl_m762":   "WeapBerylM762_C",
    "crossbow":     "WeapCrossbow_1_C",
    "crowbar":      "WeapCowbar_C",
    "dbs":          "WeapDBS_C",
    "deagle":       "WeapDesertEagle_C",
    "dp28":         "WeapDP28_C",
    "dragunov":     "WeapDragunov_C",
    "famas_g2":     "WeapFAMASG2_C",
    "g36c":         "WeapG36C_C",
    "groza":        "WeapGroza_C",
    "js9":          "WeapJS9_C",
    "k2":           "WeapK2_C",
    "kar98k":       "WeapKar98k_C",
    "lynx_amr":     "WeapL6_C",
    "m16a4":        "WeapM16A4_C",
    "m249":         "WeapM249_C",
    "m24":          "WeapM24_C",
    "m416":         "WeapHK416_C",      # M416 ist HK416 in Telem
    "m79":          "WeapM79_C",
    "machete":      "WeapMachete_C",
    "mg3":          "WeapMG3_C",
    "micro_uzi":    "WeapUZI_C",
    "mini14":       "WeapMini14_C",
    "mk12":         "WeapMk12_C",
    "mk14":         "WeapMk14_C",
    "mk47_mutant":  "WeapMk47Mutant_C",
    "mortar":       "WeapMortar_C",
    "mosin_nagant": "WeapMosinNagant_C",
    "mp5k":         "WeapMP5K_C",
    "mp9":          "WeapMP9_C",
    "o12":          "WeapOriginS12_C",
    "p18c":         "WeapG18_C",
    "p1911":        "WeapM1911_C",
    "p90":          "WeapP90_C",
    "p92":          "WeapM9_C",
    "pan":          "WeapPan_C",
    "panzerfaust":  "WeapPanzerFaust100M_C",
    "pickaxe":      "WeapPickaxe_C",
    "pp19_bizon":   "WeapBizonPP19_C",
    "qbu88":        "WeapQBU88_C",
    "qbz95":        "WeapQBZ95_C",
    "r1895":        "WeapNagantM1895_C",
    "r45":          "WeapRhino_C",
    "s12k":         "WeapSaiga12_C",
    "s1897":        "WeapWinchester_C",
    "s686":         "WeapBerreta686_C",
    "sawed_off":    "WeapSawnoff_C",
    "sickle":       "WeapSickle_C",
    "skorpion":     "Weapvz61Skorpion_C",
    "sks":          "WeapSKS_C",
    "slr":          "WeapFNFal_C",
    "stun_gun":     "WeapStunGun_C",
    "tommy_gun":    "WeapThompson_C",
    "ump45":        "WeapUMP_C",
    "vector":       "WeapVector_C",
    "vss":          "WeapVSS_C",
    "win94":        "WeapWin1894_C",
    # Wurfwaffen — die Slugs sind verwirrend, Telemetrie-Namen sind
    # ProjGrenade_C, ProjSmokeBomb_C, ProjMolotov_C etc.
    "bz_grenade":      "ProjBZGrenade_C",
    "c4":              "ProjC4_C",
    "frag_grenade":    "ProjGrenade_C",
    "molotov_cocktail":"ProjMolotov_C",
    "smoke_grenade":   "ProjSmokeBomb_C",
    "sticky_bomb":     "ProjStickyGrenade_C",
    "stun_grenade":    "ProjStunGrenade_C",
}

VEHICLE_SLUG_TO_CLASS = {
    "air_boat":     "BP_Airboat_C",
    "atv":          "BP_ATV_C",
    "boat":         "PG117_A_00_C",
    "brdm":         "BP_BRDM_C",
    "buggy":        "Buggy_A_00_C",
    "coupe_rb":     "BP_CoupeRB_C",
    "dacia":        "Dacia_A_00_v2_C",
    "dirtbike":     "BP_Dirtbike_C",
    "food_truck":   "BP_LootTruck_C",
    "jetski":       "AquaRail_A_00_C",
    "ladaniva":     "BP_Niva_00_C",
    "minibus":      "BP_Van_A_00_C",
    "mirado":       "BP_Mirado_A_00_C",
    "motorbike":    "BP_Motorbike_00_C",
    "motorglider":  "BP_Motorglider_C",
    "pickup_truck": "BP_PickupTruck_A_00_C",
    "pico_bus":     "BP_PicoBus_C",
    "pony_coupe":   "BP_PonyCoupe_C",
    "porter":       "BP_Porter_C",
    "rony":         "BP_M_Rony_A_00_C",
    "scooter":      "BP_Scooter_00_A_C",
    "snowmobile":   "BP_Snowmobile_00_C",
    "tukshai":      "BP_TukTukTuk_A_00_C",
    "uaz":          "Uaz_A_00_C",
}


def _fetch(url, timeout=12):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def download_weapon(slug, timeout=12):
    """Returns WebP-Bytes fuer Waffe."""
    return _fetch(
        f"{CDN_BASE}/weapons/images/viewer/img-weapons-{slug}.webp",
        timeout=timeout)


def download_vehicle(slug, timeout=12):
    return _fetch(
        f"{CDN_BASE}/vehicles/images/viewer/img-vehicles-{slug}.webp",
        timeout=timeout)
