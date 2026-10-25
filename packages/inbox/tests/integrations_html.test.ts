import { afterEach, describe, expect, it, vi } from "vitest";

import type { EmailAccount } from "../src/contracts";

import { convert_html_to_text, parse_email_capture, read_email_identity } from "../src/integrations/email_messages";

vi.mock(
    "obsidian",
    () => ({ requestUrl: vi.fn() }),
);

function create_account(id: string): EmailAccount {
    return {
        id,
        provider: "gmail",
        label: "Test mailbox",
        client_id: "public-client",
        tenant: "common",
        folder: "INBOX",
        query: "",
        initial_days: 7,
        is_polling_enabled: false,
        poll_interval_minutes: 15,
        account_address: "Mailbox@Example.com",
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe(
    "Inert email HTML conversion",
    () => {
        it(
            "does not invoke DOMParser even for tags that a regex could reconstruct",
            () => {
                const parser = vi.spyOn(
                    DOMParser.prototype,
                    "parseFromString",
                ).mockImplementation(() => {
                    throw new Error("A resource-capable document parser must not be used.");
                });

                const text = convert_html_to_text('<p>Readable message</p><im<img>g src="https://example.invalid/pixel"><p>After malformed markup</p>');
                expect(text).toContain("Readable message");
                expect(text).toContain("After malformed markup");
                expect(parser).not.toHaveBeenCalled();
            },
        );

        it(
            "extracts readable paragraphs and entities without resource or script content",
            () => {
                const text = convert_html_to_text('<p>Hello &amp; welcome</p><img src="https://example.invalid/tracker"><script>hidden_script()</script><style>hidden_style</style><iframe src="https://example.invalid/frame">hidden_frame</iframe><p>Second paragraph</p>');
                expect(text).toBe("Hello & welcome\nSecond paragraph");
                expect(text).not.toContain("hidden_");
                expect(text).not.toContain("example.invalid");
                expect(document.querySelector('img[src*="example.invalid"]')).toBeNull();
            },
        );

        it(
            "omits nested template content and keeps ordinary list text",
            () => {
                const text = convert_html_to_text('<template><img src="https://example.invalid/nested">Hidden template</template><ul><li>First</li><li>Second</li></ul>');
                expect(text).toContain("First\nSecond");
                expect(text).not.toContain("Hidden template");
            },
        );
    },
);

describe(
    "Stable email source identity",
    () => {
        it(
            "caps the display title while retaining the full subject and stripping NULs",
            () => {
                const subject = `${"S".repeat(300)}\u0000`;

                const capture = parse_email_capture(
                    create_account("account-1"),
                    {
                        id: "message-1",
                        payload: {
                            mimeType: "text/plain",
                            headers: [{
                                name: "Subject",
                                value: subject,
                            }],
                            body: { data: btoa("Body\u0000 text") },
                        },
                    },
                );

                expect(capture.title).toHaveLength(256);
                expect(capture.body).toContain(`Subject: ${"S".repeat(300)}`);
                expect(capture.body).toContain("Body text");
                expect(capture.body).not.toContain("\u0000");
            },
        );

        it(
            "keeps even oversized imported body and headers within the note size limit",
            () => {
                const capture = parse_email_capture(
                    create_account("account-1"),
                    {
                        id: "message-1",
                        payload: {
                            mimeType: "text/plain",
                            headers: [
                                {
                                    name: "Subject",
                                    value: "*".repeat(200_000),
                                },
                                {
                                    name: "From",
                                    value: "*".repeat(200_000),
                                },
                            ],
                            body: { data: btoa("*".repeat(200_000)) },
                        },
                    },
                );

                expect(capture.body?.length).toBeLessThan(2_000_000);
                expect(capture.body).toContain("Email content shortened");
            },
        );

        it(
            "keeps imported image Markdown, raw HTML, wiki embeds, and sender text literal",
            () => {
                const capture = parse_email_capture(
                    create_account("account-1"),
                    {
                        id: "message-1",
                        payload: {
                            mimeType: "text/plain",
                            headers: [{
                                name: "From",
                                value: "![sender](https://example.invalid/sender) <sender@example.com>",
                            }],
                            body: { data: btoa('![pixel](https://example.invalid/pixel)\n<img src="https://example.invalid/html">\n![[Private note]]\n$$x$$\n`code`') },
                        },
                    },
                );

                expect(capture.body).not.toContain("![pixel](");
                expect(capture.body).not.toContain("![sender](");
                expect(capture.body).not.toMatch(/(?<!\\)<img/);
                expect(capture.body).toContain("\\<img");
                expect(capture.body).not.toContain("![[Private note]]");
                expect(capture.body).not.toContain("$$x$$");
                expect(capture.body).toContain("\\!\\[\\[Private note\\]\\]");
                expect(capture.body).toContain("\\`code\\`");
                expect(capture.body).toContain("\\<sender@example\\.com\\>");
            },
        );

        it(
            "deduplicates a mailbox across removed and re-added account configurations",
            () => {
                const message = {
                    id: "message/1",
                    internalDate: "1700000000000",
                    payload: {
                        mimeType: "text/plain",
                        headers: [{
                            name: "Subject",
                            value: "Subject",
                        }],
                        body: { data: btoa("Message body") },
                    },
                };

                const first = parse_email_capture(
                    create_account("account-old"),
                    message,
                );

                const second = parse_email_capture(
                    create_account("account-new"),
                    message,
                );

                expect(first.source_id).toBe("email:gmail:mailbox%40example.com");
                expect(first.source_id).toBe(second.source_id);
                expect(first.external_id).toBe(second.external_id);
            },
        );

        it(
            "continues reading previously stored provider/mailbox/message identities",
            () => {
                expect(read_email_identity("gmail:mailbox%40example.com:message%2F1")).toEqual({
                    provider: "gmail",
                    mailbox: "mailbox@example.com",
                    message_id: "message/1",
                });
            },
        );
    },
);
