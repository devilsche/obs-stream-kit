"""Cache-Buster und no-cache fuer /app/tools/<key>."""
import os
import pytest


def test_bust_static_urls_appends_mtime(tmp_path):
    from app.views_app import _bust_static_urls
    (tmp_path / "tools").mkdir()
    js = tmp_path / "tools" / "x.js"
    js.write_text("//", encoding="utf-8")
    html = '<script src="/tools-static/x.js"></script>'
    out = _bust_static_urls(html, str(tmp_path))
    assert f'src="/tools-static/x.js?v={int(os.path.getmtime(js))}"' in out


def test_bust_static_urls_changes_when_the_file_changes(tmp_path):
    """Der Zweck: nach einem Deploy zeigt die URL auf etwas Neues."""
    from app.views_app import _bust_static_urls
    (tmp_path / "tools").mkdir()
    js = tmp_path / "tools" / "x.js"
    js.write_text("//", encoding="utf-8")
    html = '<script src="/tools-static/x.js"></script>'
    before = _bust_static_urls(html, str(tmp_path))
    os.utime(js, (0, 12345))
    after = _bust_static_urls(html, str(tmp_path))
    assert before != after
    assert "?v=12345" in after


def test_bust_static_urls_leaves_unknown_files_alone(tmp_path):
    from app.views_app import _bust_static_urls
    html = '<script src="/tools-static/nope.js"></script>'
    assert _bust_static_urls(html, str(tmp_path)) == html


def test_bust_static_urls_ignores_external_and_relative(tmp_path):
    from app.views_app import _bust_static_urls
    for html in ('<link href="https://fonts.googleapis.com/css2?family=X">',
                 '<script src="_pubg.js"></script>',
                 '<script src="/tools-static/x.js?v=9"></script>'):
        assert _bust_static_urls(html, str(tmp_path)) == html


def test_bust_static_urls_does_not_escape_the_root(tmp_path):
    from app.views_app import _bust_static_urls
    html = '<script src="/tools-static/../../etc/passwd"></script>'
    assert _bust_static_urls(html, str(tmp_path)) == html
