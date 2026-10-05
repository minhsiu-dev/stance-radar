"""What a pipeline lane runs per video.

A Stage owns every write to the video row it is handed -- including clearing
`claimed_at` in the same commit as its result -- and reports back how it went, so
the lane can keep its failure streak. On cancellation it gives its attempt back,
clears the claim, and re-raises.
"""
from dataclasses import dataclass
from typing import Literal, Protocol

OutcomeKind = Literal["success", "neutral", "failure"]


@dataclass(frozen=True)
class StageOutcome:
    kind: OutcomeKind
    error: str | None = None


SUCCESS = StageOutcome("success")
# A final state that is nobody's fault (e.g. no_transcript): leaves the streak alone
NEUTRAL = StageOutcome("neutral")


def failure(error: str) -> StageOutcome:
    return StageOutcome("failure", error)


class Stage(Protocol):
    async def process(self, video_id: str) -> StageOutcome: ...
