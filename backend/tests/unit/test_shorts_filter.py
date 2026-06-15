from app.pipeline.refresh import _is_short


def test_is_short_at_or_below_cutoff():
    assert _is_short(45, 240) is True
    assert _is_short(240, 240) is True   # boundary: <= is short


def test_is_short_above_cutoff_is_kept():
    assert _is_short(241, 240) is False
    assert _is_short(600, 240) is False


def test_is_short_unknown_duration_is_kept():
    assert _is_short(None, 240) is False


def test_zero_cutoff_disables_filter():
    assert _is_short(0, 0) is True      # degenerate, duration 0 only
    assert _is_short(1, 0) is False
    assert _is_short(45, 0) is False
