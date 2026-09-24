"""The threshold is illustrative; calibrate it on your own labeled traffic."""
from typesafe_sdk import Choice, TypeSafeClient

with TypeSafeClient() as client:
    response = client.system_one(
        state={"ticket": "The duplicate charge is still pending after three days."},
        questions={
            "route": Choice(
                instructions="Which team should handle this ticket?",
                criteria={"billing": "Payment issues", "support": "Other issues"},
            ),
        },
    )

answer = response.choices["route"]
route = answer.choice if answer.confidence >= 0.8 else "human_review"
print(route)
# Confidence is distinct from the winning option's probability.
