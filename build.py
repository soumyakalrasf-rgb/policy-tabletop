# Wraps the artifact page in a full HTML document for self-hosting.
import pathlib
here = pathlib.Path(__file__).parent
page = (here.parent / "index.html").read_text()
head = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex">
<style>:root{padding:env(safe-area-inset-top,0) 0 env(safe-area-inset-bottom,0)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
<script>window.TABLETOP_API = "/api/claude";</script>
</head>
<body>
"""
(here / "index.html").write_text(head + page + "\n</body>\n</html>\n")
print("wrote", here / "index.html")
