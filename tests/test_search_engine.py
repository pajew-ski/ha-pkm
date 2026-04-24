"""Tests for SearchEngine pure functions."""
import pytest

from custom_components.ha_pkm.search_engine import _parse_note, _score_note


class TestParseNote:
    def test_extracts_title_from_h1(self):
        note = _parse_note("# My Title\n\nsome body text")
        assert note["title"] == "My Title"

    def test_title_from_frontmatter(self):
        note = _parse_note("---\ntitle: FM Title\n---\nno h1 here")
        assert note["title"] == "FM Title"

    def test_h1_takes_precedence_over_frontmatter(self):
        note = _parse_note("---\ntitle: FM Title\n---\n# H1 Title\nbody")
        assert note["title"] == "H1 Title"

    def test_frontmatter_stripped_from_body(self):
        note = _parse_note("---\ntitle: T\n---\nbody text")
        assert "title:" not in note["body"]
        assert "body text" in note["body"]

    def test_empty_content(self):
        note = _parse_note("")
        assert note["title"] == ""
        assert note["body"] == ""

    def test_lower_fields_present(self):
        note = _parse_note("# UPPER\nBody TEXT")
        assert note["lower_title"] == "upper"
        assert "body text" in note["lower_body"]

    def test_frontmatter_values_in_fm_text(self):
        note = _parse_note("---\nstatus: active\n---\nbody")
        assert "active" in note["fm_text"]


class TestScoreNote:
    def _make(self, title="", body="", fm=None):
        parts = []
        if fm:
            parts.append("---")
            for k, v in fm.items():
                parts.append(f"{k}: {v}")
            parts.append("---")
        if title:
            parts.append(f"# {title}")
        parts.append(body)
        return _parse_note("\n".join(parts))

    def test_no_match_returns_zero(self):
        note = self._make(body="unrelated text")
        score, terms, _ = _score_note(note, ["missing"])
        assert score == 0
        assert terms == []

    def test_title_match_scores_higher(self):
        note_title = self._make(title="keyword topic")
        note_body  = self._make(body="keyword somewhere deep in body text")
        s_title, _, _ = _score_note(note_title, ["keyword"])
        s_body, _, _  = _score_note(note_body,  ["keyword"])
        assert s_title > s_body

    def test_multi_term_all_must_individually_score(self):
        note = self._make(body="alpha and beta")
        score, terms, _ = _score_note(note, ["alpha", "beta"])
        assert "alpha" in terms
        assert "beta" in terms
        assert score > 0

    def test_excerpt_contains_mark_tags(self):
        note = self._make(body="The keyword is here in the body.")
        _, _, excerpt = _score_note(note, ["keyword"])
        assert "<mark>" in excerpt

    def test_excerpt_ellipsis_for_long_body(self):
        long_body = "x " * 300 + "target " + "y " * 300
        note = _parse_note(long_body)
        _, _, excerpt = _score_note(note, ["target"])
        assert "..." in excerpt

    def test_frontmatter_match_scores(self):
        note = _parse_note("---\nstatus: published\n---\nbody")
        score, terms, _ = _score_note(note, ["published"])
        assert score > 0
        assert "published" in terms
