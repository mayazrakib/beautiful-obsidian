"""Create deterministic native-test fixtures without overwriting existing files."""

import argparse
import datetime
import json
from pathlib import Path
import uuid
import wave


def write_new(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)

    if not path.exists():
        path.write_text(content, encoding="utf-8")


def create_vault(vault_path, count):
    vault_path.mkdir(parents=True, exist_ok=True)
    write_new(vault_path / ".obsidian/app.json", json.dumps({"attachmentFolderPath": "Attachments", "alwaysUpdateLinks": True}, indent=4) + "\n")
    write_new(vault_path / ".obsidian/core-plugins.json", json.dumps(["file-explorer", "global-search", "switcher", "backlink", "command-palette", "outline", "word-count", "audio-recorder", "bases", "properties"], indent=4) + "\n")
    write_new(vault_path / ".obsidian/community-plugins.json", "[]\n")
    write_new(vault_path / "Welcome.md", "# Beautiful Inbox test vault\n\nThis isolated vault contains synthetic data for native verification.\n\nSee [[Meeting notes]] and [[Reference]].\n")
    write_new(vault_path / "Meeting notes.md", "# Meeting notes\n\nA sample selection to capture with its source note.\n\n- Discuss the next release.\n- Review the design gallery.\n")
    write_new(vault_path / "Reference.md", "# Reference\n\nA reference note that must remain intact when captured into Inbox.\n")
    attachments = vault_path / "Attachments"
    attachments.mkdir(exist_ok=True)
    write_new(attachments / "sample.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#6b8e9f"/><text x="30" y="95" fill="white" font-size="24">Inbox test attachment</text></svg>\n')
    audio_path = attachments / "sample.wav"

    if not audio_path.exists():
        with wave.open(str(audio_path), "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(8000)
            audio.writeframes(b"\x00\x00" * 8000)

    epoch = datetime.datetime(2026, 10, 1, tzinfo=datetime.timezone.utc)

    for index in range(count):
        captured_at = (epoch + datetime.timedelta(minutes=index)).isoformat().replace("+00:00", "Z")
        item_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"beautiful-inbox-test-{index}"))
        kind = ["text", "link", "note", "image", "audio", "email"][index % 6]
        status = "unprocessed" if index % 10 < 8 else "processed" if index % 10 == 8 else "archived"
        frontmatter = {
            "beautiful_inbox": True,
            "schema_version": 1,
            "inbox_id": item_id,
            "title": f"Capture {index:05d}: {'design review' if index % 7 == 0 else 'a useful idea'}",
            "inbox_kind": kind,
            "inbox_status": status,
            "captured_at": captured_at,
            "system_created_at": captured_at,
            "system_updated_at": captured_at,
            "tags": ["test", "work" if index % 2 else "personal"],
            "inbox_preview": "Synthetic capture for search, grouping, and performance verification.",
        }
        body = "A synthetic capture with enough text to exercise previews and truncation. " * 4

        if kind == "link":
            frontmatter["source_url"] = "https://example.com/"
            body += "\n\nhttps://example.com/\n"
        elif kind == "note":
            frontmatter["source_note"] = "Reference.md"
            body += "\n\n[[Reference]]\n"
        elif kind == "image":
            body += "\n\n![[Attachments/sample.svg]]\n"
        elif kind == "audio":
            body += "\n\n![[Attachments/sample.wav]]\n"
        elif kind == "email":
            frontmatter["source_url"] = "https://mail.google.com/"
            frontmatter["source_id"] = "fixture-mail"
            frontmatter["external_id"] = str(index)
            body += "\n\nFrom: Example Sender <sender@example.com>\n\nThis is fixture email content.\n"

        serialized = "---\n" + "\n".join(f"{key}: {json.dumps(value, ensure_ascii=False)}" for key, value in frontmatter.items()) + "\n---\n\n" + body + "\n"
        write_new(vault_path / f"Beautiful/Inbox/Items/Fixture {index:05d}.md", serialized)

    print(f"Prepared {count} synthetic captures in {vault_path}.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--path", type=Path, required=True)
    parser.add_argument("--count", type=int, default=100)
    arguments = parser.parse_args()

    if not 0 <= arguments.count <= 10000:
        parser.error("count must be between 0 and 10000")

    create_vault(arguments.path, arguments.count)
