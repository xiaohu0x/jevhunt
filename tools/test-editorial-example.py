"""Validate the published Python example with the real SDK and offline transport."""
import contextlib
from html.parser import HTMLParser
import io
import json
import pathlib

import httpx2
import typesafe_sdk


class CodeReader(HTMLParser):
    def __init__(self):
        super().__init__()
        self.inside = False
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag == "pre":
            self.inside = True

    def handle_endtag(self, tag):
        if tag == "pre":
            self.inside = False

    def handle_data(self, data):
        if self.inside:
            self.parts.append(data)


reader = CodeReader()
reader.feed(pathlib.Path("content/blog/jev-document-classification.html").read_text())
example = compile("".join(reader.parts), "published-document-example", "exec")
original = typesafe_sdk.TypeSafeClient

for selected, confidence, expected in [
    ("invoice", 0.95, "invoice"),
    ("invoice", 0.2, "review"),
    ("other", 0.95, "review"),
]:
    calls = []

    def respond(request):
        assert request.url.path == "/v1/systemone"
        body = json.loads(request.content)
        calls.append(body)
        criteria = body["questions"]["category"]["criteria"]
        assert set(criteria) == {"invoice", "contract", "correspondence", "other"}
        assert body["state"]["document"]
        return httpx2.Response(200, json={
            "model": "jev-1.13.0",
            "usage": {"input_tokens": 100},
            "answers": {"category": {
                "type": "choice", "choice": selected, "confidence": confidence,
                "probabilities": {key: 1.0 if key == selected else 0.0 for key in criteria},
            }},
        })

    def client():
        return original(api_key="offline-test-only", transport=httpx2.MockTransport(respond))

    typesafe_sdk.TypeSafeClient = client
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        exec(example, {"__name__": "__main__"})
    assert output.getvalue().strip() == expected, output.getvalue()
    assert len(calls) == 1
    print("PASS document example:", selected, confidence, "->", expected)

typesafe_sdk.TypeSafeClient = original
