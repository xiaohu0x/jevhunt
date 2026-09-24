"""Install typesafe-sdk and set TYPESAFE_API_KEY before running."""
from typesafe_sdk import Choice, TypeSafeClient

with TypeSafeClient() as client:
    response = client.system_one(
        state={"ticket": "I was charged twice. Please refund the duplicate."},
        questions={
            "intent": Choice(
                instructions="Choose the ticket's main intent.",
                criteria={
                    "refund": "A request to return a payment",
                    "bug": "A software defect",
                    "billing": "Another payment question",
                    "other": "None of the above",
                },
            ),
        },
    )

answer = response.choices["intent"]
print(answer.choice, answer.probabilities, answer.confidence)
