"""Runs the real SDK against a local mock transport; no model API requests."""
import contextlib
import io
import json
import pathlib
import runpy
import typesafe_sdk
import httpx2

original = typesafe_sdk.TypeSafeClient
calls = []

def respond(request):
    assert request.url.path == "/v1/systemone", request.url
    body = json.loads(request.content)
    calls.append(body)
    assert body["state"]
    answers = {}
    for key, question in body["questions"].items():
        kind = question["type"]
        if kind == "choice":
            choices = list(question["criteria"])
            answers[key] = {"type": kind, "choice": choices[0], "confidence": 0.9,
                            "probabilities": {c: (1.0 if i == 0 else 0.0) for i, c in enumerate(choices)}}
        elif kind == "score":
            answers[key] = {"type": kind, "score": 1.7, "confidence": 0.8,
                            "legend": {str(i): level for i, level in enumerate(question["criteria"])},
                            "probabilities": {"0": 0.0, "1": 0.3, "2": 0.7}}
        elif kind == "noul":
            answers[key] = {"type": kind, "noul": 0.8}
        else:
            raise AssertionError(kind)
    return httpx2.Response(200, json={"model": "jev-1.13.0", "usage": {"input_tokens": 100}, "answers": answers})

def client(**kwargs):
    return original(api_key="offline-test-only", transport=httpx2.MockTransport(respond), **kwargs)

typesafe_sdk.TypeSafeClient = client
for path in sorted(pathlib.Path("public/examples").glob("*.py")):
    with contextlib.redirect_stdout(io.StringIO()):
        runpy.run_path(str(path), run_name="__main__")
    print("PASS", path.name)
assert len(calls) == 4
print("All four examples validated with the real SDK and an offline transport.")
