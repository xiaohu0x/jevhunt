"""A Noul returns a yes-probability, not a separate confidence field."""
from typesafe_sdk import Noul, TypeSafeClient

with TypeSafeClient() as client:
    response = client.system_one(
        state={"ticket": "Someone used my account to make an unknown purchase."},
        questions={
            "review": Noul(
                instructions="Does this ticket describe possible account misuse?"
            ),
        },
    )

probability = response.nouls["review"].noul
print(probability)
# The threshold is an application policy, not a universal model guarantee.
print("human_review" if probability >= 0.5 else "normal_queue")
