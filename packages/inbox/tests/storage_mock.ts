import type { App } from "obsidian";

interface EventToken {
    name: string;
    callback: (...values: unknown[]) => void;
}

export class MockEvents {
    private readonly listeners = new Set<EventToken>();

    on(
        name: string,
        callback: (...values: unknown[]) => void,
    ): EventToken {
        const token = {
            name,
            callback,
        };

        this.listeners.add(token);

        return token;
    }

    offref(token: EventToken): void {
        this.listeners.delete(token);
    }

    emit(
        name: string,
        ...values: unknown[]
    ): void {
        for (const token of this.listeners) {
            if (token.name === name) {
                token.callback(...values);
            }
        }
    }
}

export class MockFolder {
    path: string;

    constructor(path: string) {
        this.path = path;
    }
}

export class MockFile {
    path: string;
    stat = {
        mtime: 0,
        ctime: 0,
        size: 0,
    };

    constructor(path: string) {
        this.path = path;
    }

    get name(): string {
        return this.path.split("/").pop() ?? "";
    }

    get basename(): string {
        return this.name.replace(
            /\.[^.]+$/,
            "",
        );
    }

    get extension(): string {
        return this.name.split(".").pop() ?? "";
    }
}

export function parse_frontmatter(content: string) {
    const match = /^---\n([\s\S]*?)\n---\n?/.exec(content);

    return {
        exists: Boolean(match),
        frontmatter: match?.[1] ?? "",
        from: 4,
        to: match ? match[0].length - 4 : 0,
        contentStart: match?.[0].length ?? 0,
    };
}

export function parse_yaml(value: string): unknown {
    return JSON.parse(value);
}

export function stringify_yaml(value: unknown): string {
    return JSON.stringify(
        value,
        null,
        4,
    );
}

export class MockVault extends MockEvents {
    readonly files = new Map<string, MockFile | MockFolder>();
    readonly contents = new Map<string, string | ArrayBuffer>();
    readonly trashed: { path: string; content: string | ArrayBuffer; is_system: boolean; }[] = [];
    read_count = 0;
    before_process: (() => void) | undefined;
    private clock = 0;
    metadata: MockMetadata | undefined;

    getAbstractFileByPath(path: string): MockFile | MockFolder | null {
        return this.files.get(path) ?? null;
    }

    getMarkdownFiles(): MockFile[] {
        return [...this.files.values()].filter((entry): entry is MockFile => entry instanceof MockFile && entry.extension === "md");
    }

    async createFolder(path: string): Promise<void> {
        if (this.files.has(path)) {
            throw new Error("Path already exists.");
        }

        this.files.set(
            path,
            new MockFolder(path),
        );
    }

    async create(
        path: string,
        content: string,
    ): Promise<MockFile> {
        if (this.files.has(path)) {
            throw new Error("Path already exists.");
        }

        const file = new MockFile(path);

        this.files.set(
            path,
            file,
        );

        this.set_content(
            file,
            content,
        );

        this.emit(
            "create",
            file,
        );

        return file;
    }

    async createBinary(
        path: string,
        content: ArrayBuffer,
    ): Promise<MockFile> {
        const file = new MockFile(path);
        file.stat.size = content.byteLength;

        this.files.set(
            path,
            file,
        );

        this.contents.set(
            path,
            content,
        );

        this.emit(
            "create",
            file,
        );

        return file;
    }

    async read(file: MockFile): Promise<string> {
        this.read_count++;
        const content = this.contents.get(file.path);

        if (typeof content !== "string") {
            throw new Error("File not readable as text.");
        }

        return content;
    }

    cachedRead(file: MockFile): Promise<string> {
        return this.read(file);
    }

    async process(
        file: MockFile,
        update: (content: string) => string,
    ): Promise<string> {
        const hook = this.before_process;
        this.before_process = undefined;
        hook?.();
        const content = this.contents.get(file.path);

        if (typeof content !== "string") {
            throw new Error("File no longer exists.");
        }

        const next = update(content);

        this.set_content(
            file,
            next,
        );

        return next;
    }

    async trash(
        file: MockFile,
        is_system: boolean,
    ): Promise<void> {
        const content = this.contents.get(file.path);

        if (content === undefined) {
            throw new Error("The file was not found.");
        }

        this.trashed.push({
            path: file.path,
            content,
            is_system,
        });

        this.contents.delete(file.path);
        this.files.delete(file.path);

        this.emit(
            "delete",
            file,
        );
    }

    getResourcePath(file: MockFile): string {
        return `app://test/${file.path}`;
    }

    set_content(
        file: MockFile,
        content: string,
    ): void {
        file.stat.mtime = ++this.clock;
        file.stat.size = content.length;

        this.contents.set(
            file.path,
            content,
        );

        this.emit(
            "modify",
            file,
        );

        this.metadata?.emit(
            "changed",
            file,
            content,
            this.metadata.getFileCache(file),
        );
    }

    rename(
        file: MockFile,
        path: string,
    ): void {
        const old_path = file.path;
        const content = this.contents.get(old_path);
        this.files.delete(old_path);
        this.contents.delete(old_path);
        file.path = path;

        this.files.set(
            path,
            file,
        );

        if (content !== undefined) {
            this.contents.set(
                path,
                content,
            );
        }

        this.emit(
            "rename",
            file,
            old_path,
        );
    }
}

export class MockMetadata extends MockEvents {
    readonly resolvedLinks: Record<string, Record<string, number>> = {};
    readonly unresolvedLinks: Record<string, Record<string, number>> = {};
    private readonly vault: MockVault;

    constructor(vault: MockVault) {
        super();
        this.vault = vault;
    }

    getFileCache(file: MockFile): { frontmatter?: Record<string, unknown>; } | null {
        const content = this.vault.contents.get(file.path);

        if (typeof content !== "string") {
            return null;
        }

        const info = parse_frontmatter(content);

        if (!info.exists) {
            return null;
        }

        try {
            return { frontmatter: parse_yaml(info.frontmatter) as Record<string, unknown> };
        } catch {
            return null;
        }
    }

    getFirstLinkpathDest(
        path: string,
        source_path: string,
    ): MockFile | null {
        const directory = source_path.slice(
            0,
            source_path.lastIndexOf("/"),
        );

        const direct = this.vault.getAbstractFileByPath(path) ?? this.vault.getAbstractFileByPath(`${directory}/${path}`);

        if (direct instanceof MockFile) {
            return direct;
        }

        return [...this.vault.files.values()].find((file): file is MockFile => file instanceof MockFile && (file.name === path || file.basename === path)) ?? null;
    }
}

export function create_test_app() {
    const vault = new MockVault();
    const metadata = new MockMetadata(vault);
    vault.metadata = metadata;

    const app = {
        vault,
        metadataCache: metadata,
    } as unknown as App;

    return {
        app,
        vault,
        metadata,
    };
}

export function create_test_file(
    name: string,
    content = "example",
): File {
    const bytes = new TextEncoder().encode(content);

    const file = new File(
        [bytes],
        name,
    );

    Object.defineProperty(
        file,
        "arrayBuffer",
        { value: async () => bytes.buffer },
    );

    return file;
}
