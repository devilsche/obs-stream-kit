from webcore.serving import inject_window_vars


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
