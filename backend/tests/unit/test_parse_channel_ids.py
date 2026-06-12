from app.api.channels import parse_channel_ids


def test_splits_on_newline_comma_and_whitespace():
    raw = "UCaaa, UCbbb\nUCccc   UCddd"
    assert parse_channel_ids(raw) == ["UCaaa", "UCbbb", "UCccc", "UCddd"]


def test_dedupes_preserving_order():
    assert parse_channel_ids("UCaaa,UCbbb,UCaaa") == ["UCaaa", "UCbbb"]


def test_empty_input_returns_empty_list():
    assert parse_channel_ids("  \n , ") == []
