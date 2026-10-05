from app.models import VideoStatus
from app.pipeline.queueing import queue_status_for


def test_a_stored_transcript_goes_straight_to_the_analysis_lane():
    assert queue_status_for(True) is VideoStatus.transcribed


def test_no_transcript_goes_to_the_transcript_lane():
    assert queue_status_for(False) is VideoStatus.pending
