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
