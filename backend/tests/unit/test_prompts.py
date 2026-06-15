from app.analysis.prompts import ANALYSIS_TOOL, SYSTEM_PROMPT, build_user_prompt
from app.transcripts.client import TranscriptSegment


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
