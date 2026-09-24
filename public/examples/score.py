"""Score is the expected rubric index and may be fractional."""
from typesafe_sdk import Score, TypeSafeClient

candidates = {"basic": "Email support", "pro": "24/7 live support"}
with TypeSafeClient() as client:
    response = client.system_one(
        state={"request": "I need support available at night."},
        questions={
            key: Score(
                instructions={"task": "Rate this plan's fit.", "plan": plan},
                criteria=["poor fit", "partial fit", "strong fit"],
            )
            for key, plan in candidates.items()
        },
    )

ranked = sorted(
    response.scores.items(), key=lambda item: item[1].score, reverse=True
)
for name, answer in ranked:
    print(name, answer.score, answer.confidence)
