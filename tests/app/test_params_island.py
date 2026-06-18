from app.widget_catalog import _extract_params_island


def test_island_parsed_as_schema():
    html = '''<html><body>
    <script type="application/json" id="params">
    [{"key":"port","label":"Port","type":"text","default":"9210"},
     {"key":"scope","label":"Scope","type":"select","default":"all","options":[["session","Session"],["all","All"]]}]
    </script></body></html>'''
    s = _extract_params_island(html)
    assert [p["key"] for p in s] == ["port", "scope"]
    assert s[1]["options"] == [["session", "Session"], ["all", "All"]]


def test_absent_island_returns_empty():
    assert _extract_params_island("<html><body>nix</body></html>") == []


def test_malformed_island_returns_empty():
    assert _extract_params_island('<script type="application/json" id="params">{kaputt</script>') == []
