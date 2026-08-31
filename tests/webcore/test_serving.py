import os
import pytest
from flask import Flask
from werkzeug.exceptions import NotFound
from webcore.serving import inject_window_vars, serve_asset, serve_html_or_asset


def _ctx():
    return Flask(__name__).test_request_context()


def test_inject_inserts_before_head_close():
    html = "<html><head><title>x</title></head><body></body></html>"
    out = inject_window_vars(html, {"__SERVE_BASE__": "/s/tok/",
                                     "__TWITCH_CHANNEL__": "luckor"})
    assert 'window.__SERVE_BASE__ = "/s/tok/";' in out
    assert 'window.__TWITCH_CHANNEL__ = "luckor";' in out
    # vor </head> eingefügt
    assert out.index("window.__SERVE_BASE__") < out.index("</head>")


def test_inject_prepends_when_no_head():
    html = "<body>x</body>"
    out = inject_window_vars(html, {"__SERVE_BASE__": "/s/tok/"})
    assert out.startswith("<script>")


def test_serve_html_or_asset_injects(tmp_path):
    base = tmp_path / "overlays"
    base.mkdir()
    (base / "x.html").write_text("<head></head>", encoding="utf-8")
    with _ctx():
        body, status, headers = serve_html_or_asset(
            str(tmp_path), "overlays", "x.html", {"__SERVE_BASE__": "/s/t/"})
    assert status == 200
    assert headers["Content-Type"] == "text/html; charset=utf-8"
    assert 'window.__SERVE_BASE__ = "/s/t/";' in body


def test_serve_asset_rejects_sibling_prefix_escape(tmp_path):
    (tmp_path / "widgets").mkdir()
    evil = tmp_path / "widgets-evil"
    evil.mkdir()
    (evil / "secret.txt").write_text("nope", encoding="utf-8")
    with _ctx():
        with pytest.raises(NotFound):
            serve_asset(str(tmp_path), "widgets", "../widgets-evil/secret.txt")


def test_serve_asset_rejects_parent_traversal(tmp_path):
    (tmp_path / "widgets").mkdir()
    (tmp_path / "secret.txt").write_text("nope", encoding="utf-8")
    with _ctx():
        with pytest.raises(NotFound):
            serve_asset(str(tmp_path), "widgets", "../secret.txt")


# ── Impersonation-Banner ────────────────────────────────────────────────────

from webcore.serving import inject_impersonation_banner  # noqa: E402


def test_banner_names_the_foreign_tenant():
    html = "<html><head></head><body><h1>Tool</h1></body></html>"
    out = inject_impersonation_banner(
        html, {"id": 2, "slug": "originalhat3", "display_name": "Hat3"},
        "/app/tools/match-analysis")
    assert "Hat3" in out
    # Direkt nach <body>, damit das Banner nichts ueberdeckt (WCAG 2.4.12).
    assert out.index("obs-impersonation") < out.index("<h1>")


def test_banner_exit_link_drops_the_parameter():
    out = inject_impersonation_banner(
        "<html><head></head><body></body></html>",
        {"id": 2, "slug": "h3", "display_name": "H3"},
        "/app/tools/weapon-performance?range=week")
    assert 'href="/app/tools/weapon-performance?range=week"' in out


def test_banner_escapes_the_tenant_name():
    out = inject_impersonation_banner(
        "<html><head></head><body></body></html>",
        {"id": 2, "slug": "x", "display_name": '<script>alert(1)</script>'},
        "/app/")
    assert "<script>alert(1)</script>" not in out
    assert "&lt;script&gt;" in out


def test_banner_without_impersonation_is_a_noop():
    html = "<html><head></head><body>x</body></html>"
    assert inject_impersonation_banner(html, None, "/app/") == html


def test_banner_without_body_tag_still_lands_in_the_page():
    out = inject_impersonation_banner(
        "<div>kein body-Tag</div>",
        {"id": 3, "slug": "flip", "display_name": "Flip"}, "/app/")
    assert "obs-impersonation" in out
    assert out.index("obs-impersonation") < out.index("kein body-Tag")


def test_banner_uses_no_inline_styles():
    """Projekt-Regel: nichts Visuelles im style-Attribut."""
    out = inject_impersonation_banner(
        "<html><head></head><body></body></html>",
        {"id": 2, "slug": "h3", "display_name": "H3"}, "/app/")
    assert 'style="' not in out


def test_banner_survives_a_page_with_body_padding():
    """Der Achievement-Browser gibt dem body padding — das Banner soll
    trotzdem randlos oben sitzen, nicht eingerueckt im Inhalt schweben."""
    out = inject_impersonation_banner(
        "<html><head></head><body></body></html>",
        {"id": 2, "slug": "h3", "display_name": "H3"}, "/app/")
    assert "body:has(> .obs-impersonation)" in out
    assert "padding-top: 0" in out
    # 100vw braucht clip statt hidden: hidden macht den body zum
    # Scroll-Container und bricht damit position: sticky.
    assert "overflow-x: clip" in out
    assert "width: 100vw" in out
