from app.analysis.prompts import ANALYSIS_TOOL, SYSTEM_PROMPT, build_user_prompt
from app.transcripts.client import TranscriptSegment


def test_system_prompt_classifies_conditional_waiting_as_neutral():
    """A directional view the speaker is only waiting to act on (e.g. 'buy at lower
    levels') must be documented as neutral, so the rule isn't silently dropped."""
    text = SYSTEM_PROMPT.lower()
    assert "currently actionable" in text
    assert "lower levels" in text
    # the 'acting now + conditional add stays buy/sell' carve-out must be present too
    assert "add" in text and "is_conditional" in SYSTEM_PROMPT


def test_system_prompt_contains_core_rules():
    assert "US-listed stock" in SYSTEM_PROMPT
    assert "AAPL" in SYSTEM_PROMPT  # normalization example
    assert "record_analysis" in SYSTEM_PROMPT


def test_tool_schema_constrains_stance_enum():
    props = ANALYSIS_TOOL["input_schema"]["properties"]
    mention_props = props["mentions"]["items"]["properties"]
    stance_props = props["stances"]["items"]["properties"]
    assert mention_props["stance"]["enum"] == ["buy", "neutral", "sell"]
    assert stance_props["stance"]["enum"] == ["buy", "neutral", "sell"]
    assert ANALYSIS_TOOL["name"] == "record_analysis"


def test_user_prompt_embeds_title_and_timestamped_lines():
    segments = (
        TranscriptSegment(start_seconds=12.5, text="蘋果很強"),
        TranscriptSegment(start_seconds=60.0, text="輝達觀望"),
    )
    prompt = build_user_prompt("AAPL 財報解讀", segments)
    assert "AAPL 財報解讀" in prompt
    assert "[12.5] 蘋果很強" in prompt
    assert "[60.0] 輝達觀望" in prompt


def test_tool_schema_requires_overall_is_conditional():
    stance_item = ANALYSIS_TOOL["input_schema"]["properties"]["stances"]["items"]
    assert "is_conditional" in stance_item["properties"]
    assert "is_conditional" in stance_item["required"]


def test_system_prompt_treats_relayed_third_party_view_as_neutral():
    assert "another investor" in SYSTEM_PROMPT
    assert "Burry" in SYSTEM_PROMPT  # concrete example anchoring the rule


def test_tool_schema_includes_top_level_tldr():
    schema = ANALYSIS_TOOL["input_schema"]
    assert schema["properties"]["tldr"]["type"] == "array"
    assert schema["properties"]["tldr"]["items"] == {"type": "string"}
    assert "tldr" in schema["required"]


def test_system_prompt_requires_tldr_even_without_mentions():
    # The rule must survive prompt edits: TL;DR bullets, in English, and produced
    # even for videos with no US-stock mention (rule 7 must not swallow it).
    assert "TL;DR" in SYSTEM_PROMPT
    assert "no US stock" in SYSTEM_PROMPT
