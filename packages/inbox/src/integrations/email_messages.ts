import type { CaptureInput, EmailAccount } from "../contracts";

import { read_object, read_objects, read_string } from "./email_http";

const MAX_EMAIL_BODY_CHARACTERS = 100_000;
const MAX_EMAIL_HEADER_CHARACTERS = 100_000;
const MAX_EMAIL_TITLE_CHARACTERS = 256;

export interface EmailAttachmentDescriptor {
    id: string;
    name: string;
    size_bytes: number;
    content_type: string;
    data?: string;
}

export function decode_base64_url(data: string): Uint8Array {
    const normalized = data.replaceAll(
        "-",
        "+",
    ).replaceAll(
        "_",
        "/",
    );

    const binary = atob(normalized.padEnd(
        Math.ceil(normalized.length / 4) * 4,
        "=",
    ));

    return Uint8Array.from(
        binary,
        (character) => character.charCodeAt(0),
    );
}

export function convert_html_to_text(html: string): string {
    // Template contents have no browsing context and are never mounted into the application.
    const template = document.createElement("template");
    template.innerHTML = html;
    const content = template.content;

    for (const element of content.querySelectorAll("script,style,iframe,object,embed,img,image,picture,source,link,base,meta,audio,video,svg,math,template,noscript")) {
        element.remove();
    }

    for (const element of content.querySelectorAll("br,p,div,li,tr,h1,h2,h3,h4")) {
        element.append(document.createTextNode("\n"));
    }

    return (content.textContent ?? "").replace(
        /\n{3,}/g,
        "\n\n",
    ).trim();
}

export function get_gmail_parts(payload: unknown): Record<string, unknown>[] {
    const root = read_object(payload);
    const parts = [root];

    for (const part of read_objects(root.parts)) {
        parts.push(...get_gmail_parts(part));
    }

    return parts;
}

function get_header(
    payload: Record<string, unknown>,
    name: string,
): string {
    const header = read_objects(payload.headers).find((candidate) => read_string(candidate.name).toLowerCase() === name);

    return read_string(header?.value);
}

export function create_email_identity(
    account: EmailAccount,
    message_id: string,
): string {
    const mailbox = (account.account_address || account.id).toLowerCase();

    return `${account.provider}:${encodeURIComponent(mailbox)}:${encodeURIComponent(message_id)}`;
}

export function read_email_identity(identity: string): { provider: string; mailbox: string; message_id: string; } {
    const [provider, mailbox, message_id, extra] = identity.split(":");

    if (!provider || !mailbox || !message_id || extra !== undefined || !["gmail", "outlook"].includes(provider)) {
        throw new Error("This capture does not contain a usable email reference.");
    }

    return {
        provider,
        mailbox: decodeURIComponent(mailbox),
        message_id: decodeURIComponent(message_id),
    };
}

export function escape_email_text(value: string): string {
    return value.replaceAll(
        "\u0000",
        "",
    ).replace(
        /[\\`*_{}()[\]#+.!<>|~$=^-]/g,
        "\\$&",
    );
}

export function parse_email_capture(
    account: EmailAccount,
    message: Record<string, unknown>,
): CaptureInput {
    const message_id = read_string(message.id);

    if (!message_id) {
        throw new Error("An email message was missing its identifier.");
    }

    let title: string;
    let body: string;
    let sender: string;
    let received_at: string;
    let source_url: string;

    if (account.provider === "gmail") {
        const payload = read_object(message.payload);
        const parts = get_gmail_parts(payload);
        const text_part = parts.find((part) => part.mimeType === "text/plain" && read_object(part.body).data);
        const html_part = parts.find((part) => part.mimeType === "text/html" && read_object(part.body).data);
        const selected_part = text_part ?? html_part;
        const encoded_body = read_string(read_object(selected_part?.body).data);
        const decoded_body = encoded_body ? new TextDecoder().decode(decode_base64_url(encoded_body)) : read_string(message.snippet);
        body = text_part ? decoded_body : convert_html_to_text(decoded_body);

        title = get_header(
            payload,
            "subject",
        ) || "Untitled email";

        sender = get_header(
            payload,
            "from",
        );

        const timestamp_ms = Number(message.internalDate);
        received_at = Number.isFinite(timestamp_ms) && timestamp_ms > 0 ? new Date(timestamp_ms).toISOString() : new Date().toISOString();
        source_url = `https://mail.google.com/mail/u/${encodeURIComponent(account.account_address ?? "0")}/#all/${encodeURIComponent(message_id)}`;
    } else {
        const content = read_object(message.body);

        body = read_string(
            content.content,
            read_string(message.bodyPreview),
        );

        if (read_string(content.contentType).toLowerCase() === "html") {
            body = convert_html_to_text(body);
        }

        title = read_string(
            message.subject,
            "Untitled email",
        );

        const address = read_object(read_object(message.from).emailAddress);
        sender = read_string(address.name) ? `${read_string(address.name)} <${read_string(address.address)}>` : read_string(address.address);
        const date = new Date(read_string(message.receivedDateTime));
        received_at = Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
        const web_link = read_string(message.webLink);
        source_url = /^https:\/\/(?:outlook\.office\.com|outlook\.office365\.com|outlook\.live\.com)\//.test(web_link) ? web_link : "https://outlook.office.com/mail/";
    }

    const normalized_title = title.replaceAll(
        "\u0000",
        "",
    ).replace(
        /\s+/g,
        " ",
    ).trim();
    let display_title = "";

    for (const character of normalized_title) {
        if (display_title.length + character.length > MAX_EMAIL_TITLE_CHARACTERS) {
            break;
        }

        display_title += character;
    }

    const is_truncated = body.length > MAX_EMAIL_BODY_CHARACTERS || title.length > MAX_EMAIL_HEADER_CHARACTERS || sender.length > MAX_EMAIL_HEADER_CHARACTERS;

    const safe_sender = sender.replace(
        /[\r\n]+/g,
        " ",
    ).slice(
        0,
        MAX_EMAIL_HEADER_CHARACTERS,
    );
    const full_subject = title.slice(
        0,
        MAX_EMAIL_HEADER_CHARACTERS,
    );

    const message_body = body.slice(
        0,
        MAX_EMAIL_BODY_CHARACTERS,
    );

    return {
        title: display_title || "Untitled email",
        body: `Subject: ${escape_email_text(full_subject)}\nFrom: ${escape_email_text(safe_sender)}\nReceived: ${received_at}\nSource: ${source_url}\n\n${escape_email_text(message_body)}${is_truncated ? "\n\n[Email content shortened. Open the source email for the complete message.]" : ""}`,
        kind: "email",
        captured_at: received_at,
        source_url,
        source_id: `email:${account.provider}:${encodeURIComponent((account.account_address || account.id).toLowerCase())}`,
        external_id: create_email_identity(
            account,
            message_id,
        ),
    };
}

export function get_email_attachment_descriptors(
    provider: "gmail" | "outlook",
    response: Record<string, unknown>,
): EmailAttachmentDescriptor[] {
    if (provider === "gmail") {
        return get_gmail_parts(response.payload).filter((part) => read_string(part.filename)).map((part) => {
            const body = read_object(part.body);

            return {
                id: read_string(body.attachmentId),
                name: read_string(part.filename),
                size_bytes: Number(body.size) || 0,
                content_type: read_string(
                    part.mimeType,
                    "application/octet-stream",
                ),
                ...(typeof body.data === "string" ? { data: body.data } : {}),
            };
        });
    }

    return read_objects(response.value).filter((attachment) => attachment["@odata.type"] === "#microsoft.graph.fileAttachment").map((attachment) => ({
        id: read_string(attachment.id),
        name: read_string(
            attachment.name,
            "attachment",
        ),
        size_bytes: Number(attachment.size) || 0,
        content_type: read_string(
            attachment.contentType,
            "application/octet-stream",
        ),
        ...(typeof attachment.contentBytes === "string" ? { data: attachment.contentBytes } : {}),
    }));
}
