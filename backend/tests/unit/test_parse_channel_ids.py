from app.api.channels import classify_channel_ref, parse_channel_ids


def test_splits_on_newline_comma_and_whitespace():
    raw = "UCaaa, UCbbb\nUCccc   UCddd"
    assert parse_channel_ids(raw) == ["UCaaa", "UCbbb", "UCccc", "UCddd"]


def test_dedupes_preserving_order():
    assert parse_channel_ids("UCaaa,UCbbb,UCaaa") == ["UCaaa", "UCbbb"]


def test_empty_input_returns_empty_list():
    assert parse_channel_ids("  \n , ") == []


def test_classify_raw_channel_id():
    assert classify_channel_ref("UCbta0n8i6Rljh0obO7HzG9A") == (
        "id", "UCbta0n8i6Rljh0obO7HzG9A",
    )


def test_classify_handle():
    assert classify_channel_ref("@SomeChannel") == ("handle", "@SomeChannel")


def test_classify_bare_name_as_handle():
    assert classify_channel_ref("SomeChannel") == ("handle", "SomeChannel")


def test_classify_channel_url():
    assert classify_channel_ref(
        "https://www.youtube.com/channel/UCbta0n8i6Rljh0obO7HzG9A/videos"
    ) == ("id", "UCbta0n8i6Rljh0obO7HzG9A")


def test_classify_handle_url():
    assert classify_channel_ref("https://www.youtube.com/@SomeChannel") == (
        "handle", "@SomeChannel",
    )


def test_classify_legacy_custom_url():
    assert classify_channel_ref("youtube.com/c/SomeName") == ("handle", "SomeName")
