/* ==========================================================================
   JevHunt — data layer
   UI metadata and examples. The generated project catalog lives
   in projects.js and is refreshed by tools/sync-projects.mjs.
   ========================================================================== */

window.JH = window.JH || {};

/* ------------------------------ categories ------------------------------ */
JH.categories = [
  { id: "official",     name: "Official",               icon: "◎", desc: "Official SDKs and open resources" },
  { id: "sdks",         name: "SDKs & Clients",         icon: "{}", desc: "Community clients across languages" },
  { id: "integrations", name: "Integrations",           icon: "⎇", desc: "Frameworks, gateways and platforms" },
  { id: "agents",       name: "Agent Tooling",          icon: "⌘", desc: "Gates, routers, reviewers, MCPs and skills" },
  { id: "browser",      name: "Browser & Computer Use", icon: "◫", desc: "Browser, desktop and mobile automation" },
  { id: "apps",         name: "Applications",           icon: "✦", desc: "Products, utilities and decision pipelines" },
  { id: "games",        name: "Games & Simulations",    icon: "◇", desc: "Playable projects and simulations" },
  { id: "demos",        name: "Demos & Playgrounds",    icon: "▸", desc: "Experiments and interactive playgrounds" },
  { id: "research",     name: "Benchmarks & Research",  icon: "∿", desc: "Evals, calibration studies and open replicas" },
  { id: "lists",        name: "Directories & Lists",    icon: "≡", desc: "Community-maintained Jev collections" },
];

JH.playbooks = [
  {
    "id": "classify",
    "label": "classify",
    "file": "classify.py",
    "mode": "Official Python SDK",
    "desc": "Classify a complete support ticket with a Choice question.",
    "list": [
      "Install typesafe-sdk",
      "Set TYPESAFE_API_KEY",
      "Evaluate thresholds on your own data"
    ],
    "code": "\"\"\"Install typesafe-sdk and set TYPESAFE_API_KEY before running.\"\"\"\nfrom typesafe_sdk import Choice, TypeSafeClient\n\nwith TypeSafeClient() as client:\n    response = client.system_one(\n        state={\"ticket\": \"I was charged twice. Please refund the duplicate.\"},\n        questions={\n            \"intent\": Choice(\n                instructions=\"Choose the ticket's main intent.\",\n                criteria={\n                    \"refund\": \"A request to return a payment\",\n                    \"bug\": \"A software defect\",\n                    \"billing\": \"Another payment question\",\n                    \"other\": \"None of the above\",\n                },\n            ),\n        },\n    )\n\nanswer = response.choices[\"intent\"]\nprint(answer.choice, answer.probabilities, answer.confidence)\n"
  },
  {
    "id": "route",
    "label": "route",
    "file": "route.py",
    "mode": "Official Python SDK",
    "desc": "Route only when the Choice confidence meets your application threshold.",
    "list": [
      "Install typesafe-sdk",
      "Set TYPESAFE_API_KEY",
      "Evaluate thresholds on your own data"
    ],
    "code": "\"\"\"The threshold is illustrative; calibrate it on your own labeled traffic.\"\"\"\nfrom typesafe_sdk import Choice, TypeSafeClient\n\nwith TypeSafeClient() as client:\n    response = client.system_one(\n        state={\"ticket\": \"The duplicate charge is still pending after three days.\"},\n        questions={\n            \"route\": Choice(\n                instructions=\"Which team should handle this ticket?\",\n                criteria={\"billing\": \"Payment issues\", \"support\": \"Other issues\"},\n            ),\n        },\n    )\n\nanswer = response.choices[\"route\"]\nroute = answer.choice if answer.confidence >= 0.8 else \"human_review\"\nprint(route)\n# Confidence is distinct from the winning option's probability.\n"
  },
  {
    "id": "score",
    "label": "score",
    "file": "score.py",
    "mode": "Official Python SDK",
    "desc": "Rank plans against an explicit ordered rubric.",
    "list": [
      "Install typesafe-sdk",
      "Set TYPESAFE_API_KEY",
      "Evaluate thresholds on your own data"
    ],
    "code": "\"\"\"Score is the expected rubric index and may be fractional.\"\"\"\nfrom typesafe_sdk import Score, TypeSafeClient\n\ncandidates = {\"basic\": \"Email support\", \"pro\": \"24/7 live support\"}\nwith TypeSafeClient() as client:\n    response = client.system_one(\n        state={\"request\": \"I need support available at night.\"},\n        questions={\n            key: Score(\n                instructions={\"task\": \"Rate this plan's fit.\", \"plan\": plan},\n                criteria=[\"poor fit\", \"partial fit\", \"strong fit\"],\n            )\n            for key, plan in candidates.items()\n        },\n    )\n\nranked = sorted(\n    response.scores.items(), key=lambda item: item[1].score, reverse=True\n)\nfor name, answer in ranked:\n    print(name, answer.score, answer.confidence)\n"
  },
  {
    "id": "noul",
    "label": "noul",
    "file": "noul.py",
    "mode": "Official Python SDK",
    "desc": "Read the probability of a yes/no judgment.",
    "list": [
      "Install typesafe-sdk",
      "Set TYPESAFE_API_KEY",
      "Evaluate thresholds on your own data"
    ],
    "code": "\"\"\"A Noul returns a yes-probability, not a separate confidence field.\"\"\"\nfrom typesafe_sdk import Noul, TypeSafeClient\n\nwith TypeSafeClient() as client:\n    response = client.system_one(\n        state={\"ticket\": \"Someone used my account to make an unknown purchase.\"},\n        questions={\n            \"review\": Noul(\n                instructions=\"Does this ticket describe possible account misuse?\"\n            ),\n        },\n    )\n\nprobability = response.nouls[\"review\"].noul\nprint(probability)\n# The threshold is an application policy, not a universal model guarantee.\nprint(\"human_review\" if probability >= 0.5 else \"normal_queue\")\n"
  }
];
JH.timeline = [
  {
    "date": "2026-09-20",
    "title": "JevHunt directory opens",
    "desc": "Public directory and Google project submissions."
  },
  {
    "date": "2026-09-22",
    "title": "Nine language editions",
    "desc": "Localized discovery pages and static catalog previews."
  },
  {
    "date": "2026-09-24",
    "title": "Evidence and publishing",
    "desc": "Multiple discovery sources, source references, editorial review and release verification."
  }
];
