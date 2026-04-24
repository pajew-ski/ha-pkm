"""Tests for NoteDatabase pure functions."""
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from custom_components.ha_pkm.database import _extract_metadata, _matches


# ---------------------------------------------------------------------------
# _extract_metadata
# ---------------------------------------------------------------------------

class TestExtractMetadata:
    def test_title_from_frontmatter(self, tmp_path):
        f = tmp_path / "note.md"
        f.write_text("---\ntitle: My Note\n---\nbody")
        meta = _extract_metadata("note.md", f.read_text(), f)
        assert meta["title"] == "My Note"

    def test_title_fallback_to_stem(self, tmp_path):
        f = tmp_path / "my-note.md"
        f.write_text("no frontmatter")
        meta = _extract_metadata("my-note.md", f.read_text(), f)
        assert meta["title"] == "my-note"

    def test_frontmatter_fields_in_meta(self, tmp_path):
        f = tmp_path / "note.md"
        f.write_text("---\ntags: [work, home]\nstatus: active\n---\nbody")
        meta = _extract_metadata("note.md", f.read_text(), f)
        assert meta["status"] == "active"
        assert "work" in meta["tags"]

    def test_mtime_and_size_populated(self, tmp_path):
        f = tmp_path / "note.md"
        f.write_text("hello")
        meta = _extract_metadata("note.md", f.read_text(), f)
        assert meta["mtime"] > 0
        assert meta["size"] > 0

    def test_missing_file_returns_zeros(self, tmp_path):
        ghost = tmp_path / "ghost.md"
        meta = _extract_metadata("ghost.md", "", ghost)
        assert meta["mtime"] == 0
        assert meta["size"] == 0

    def test_invalid_yaml_does_not_crash(self, tmp_path):
        f = tmp_path / "bad.md"
        f.write_text("---\n: invalid: yaml: here\n---\nbody")
        meta = _extract_metadata("bad.md", f.read_text(), f)
        assert meta["title"] == "bad"


# ---------------------------------------------------------------------------
# _matches
# ---------------------------------------------------------------------------

class TestMatches:
    def test_equality(self):
        assert _matches({"status": "active"}, {"status": "active"})
        assert not _matches({"status": "draft"}, {"status": "active"})

    def test_contains_string(self):
        assert _matches({"title": "Hello World"}, {"title": {"$contains": "World"}})
        assert not _matches({"title": "Hello"}, {"title": {"$contains": "World"}})

    def test_contains_list(self):
        assert _matches({"tags": ["work", "home"]}, {"tags": {"$contains": "work"}})
        assert not _matches({"tags": ["home"]}, {"tags": {"$contains": "work"}})

    def test_contains_missing_field(self):
        assert not _matches({}, {"tags": {"$contains": "work"}})

    def test_ne(self):
        assert _matches({"status": "draft"}, {"status": {"$ne": "active"}})
        assert not _matches({"status": "active"}, {"status": {"$ne": "active"}})

    def test_starts_with(self):
        assert _matches({"path": "projects/foo.md"}, {"path": {"$startsWith": "projects/"}})
        assert not _matches({"path": "notes/foo.md"}, {"path": {"$startsWith": "projects/"}})

    def test_before(self):
        assert _matches({"mtime": 100.0}, {"mtime": {"$before": 200.0}})
        assert not _matches({"mtime": 300.0}, {"mtime": {"$before": 200.0}})

    def test_after(self):
        assert _matches({"mtime": 300.0}, {"mtime": {"$after": 200.0}})
        assert not _matches({"mtime": 100.0}, {"mtime": {"$after": 200.0}})

    def test_is_empty_true(self):
        assert _matches({"tags": []}, {"tags": {"$isEmpty": True}})
        assert _matches({"tags": None}, {"tags": {"$isEmpty": True}})
        assert _matches({}, {"tags": {"$isEmpty": True}})
        assert not _matches({"tags": ["x"]}, {"tags": {"$isEmpty": True}})

    def test_is_empty_false(self):
        assert _matches({"tags": ["x"]}, {"tags": {"$isEmpty": False}})
        assert not _matches({"tags": []}, {"tags": {"$isEmpty": False}})

    def test_is_not_empty(self):
        assert _matches({"notes": "some text"}, {"notes": {"$isNotEmpty": True}})
        assert not _matches({"notes": ""}, {"notes": {"$isNotEmpty": True}})

    def test_multiple_conditions_all_must_match(self):
        meta = {"status": "active", "priority": "high"}
        assert _matches(meta, {"status": "active", "priority": "high"})
        assert not _matches(meta, {"status": "active", "priority": "low"})

    def test_empty_filter_matches_everything(self):
        assert _matches({"anything": "goes"}, {})
        assert _matches({}, {})
