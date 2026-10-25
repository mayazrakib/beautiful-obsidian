import { MarkdownView } from "obsidian";

import type { AudioCapture, AudioState, InboxHost } from "../contracts";

const SAVE_TIMEOUT_MS = 20_000;
const SAVE_CHECK_INTERVAL_MS = 250;

interface CoreRecorder {
    recording: boolean;
    recorder: MediaRecorder | null;
    extension: string;
    checkPermission: () => Promise<boolean>;
    onStartRecording: () => Promise<void>;
    onStopRecording: () => void;
}

function read_core_recorder(host: InboxHost): CoreRecorder | undefined {
    const app = host.app as unknown as {
        internalPlugins?: { getEnabledPluginById?: (id: string) => unknown; };
    };

    const registry = app.internalPlugins;

    if (!registry || typeof registry.getEnabledPluginById !== "function") {
        return undefined;
    }

    const candidate = registry.getEnabledPluginById("audio-recorder") as Partial<CoreRecorder> | null;

    if (!candidate || typeof candidate.recording !== "boolean" || typeof candidate.checkPermission !== "function" || typeof candidate.onStartRecording !== "function" || typeof candidate.onStopRecording !== "function" || !(candidate.recorder === null || (typeof candidate.recorder === "object" && typeof candidate.recorder.addEventListener === "function"))) {
        return undefined;
    }

    return candidate as CoreRecorder;
}

export class CoreAudioCapture implements AudioCapture {
    private state: AudioState = {
        phase: "idle",
        message: "Record into an Inbox capture with Obsidian's core Audio recorder.",
    };
    private readonly listeners = new Set<() => void>();
    private owned_recorder: MediaRecorder | undefined;
    private owned_core: CoreRecorder | undefined;
    private owned_item_id: string | undefined;
    private baseline_paths = new Set<string>();
    private recording_cleanup: (() => void) | undefined;
    private save_operation: Promise<void> | undefined;
    private cancel_save_observation: (() => void) | undefined;
    private should_confirm_stop = false;
    private is_disposed = false;

    constructor(private readonly host: InboxHost) { }

    get_state(): AudioState {
        if (this.state.phase === "idle" || this.state.phase === "unavailable") {
            const is_available = this.host.get_settings().is_audio_enabled && Boolean(read_core_recorder(this.host));

            return is_available ? {
                phase: "idle",
                message: "Record an audio capture.",
            } : {
                phase: "unavailable",
                message: "Enable the core Audio recorder in Obsidian settings to record here.",
            };
        }

        return { ...this.state };
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);

        return () => this.listeners.delete(listener);
    }

    private set_state(state: AudioState): void {
        this.state = state;

        for (const listener of this.listeners) {
            listener();
        }
    }

    private async activate_recording_note(item_id: string): Promise<void> {
        await this.host.open_note(item_id);

        const item = this.host.repository.get_item(item_id);
        const view = this.host.app.workspace.getActiveViewOfType(MarkdownView);

        if (!item || view?.file?.path !== item.path) {
            throw new Error("Open the audio capture as a Markdown note before recording.");
        }

        const line = view.editor.lastLine();

        view.editor.setCursor({
            line,
            ch: view.editor.getLine(line).length,
        });
    }

    async start(): Promise<void> {
        if (this.is_disposed || ["starting", "recording", "saving"].includes(this.state.phase)) {
            throw new Error("Finish the current audio capture before starting another.");
        }

        const core = read_core_recorder(this.host);

        if (!this.host.get_settings().is_audio_enabled || !core) {
            this.set_state({
                phase: "unavailable",
                message: "Enable the core Audio recorder to record an Inbox capture.",
            });

            return;
        }

        if (core.recording || core.recorder) {
            throw new Error("Obsidian already has an audio recording in progress. Finish it before starting an Inbox recording.");
        }

        this.set_state({
            phase: "starting",
            message: "Waiting for Obsidian's microphone permission.",
        });

        try {
            if (!await core.checkPermission()) {
                throw new Error("Microphone access was not granted. Check your operating system's microphone settings.");
            }

            if (this.is_disposed || core.recording || core.recorder) {
                throw new Error("Audio capture could not start because the recorder is no longer available.");
            }

            const result = await this.host.repository.capture({
                title: "Audio capture",
                kind: "audio",
                body: "",
            });

            this.owned_item_id = result.item.id;
            this.baseline_paths = new Set((await this.host.repository.list_attachments(result.item.id)).map((attachment) => attachment.path));
            await this.activate_recording_note(result.item.id);

            // Core command dispatch does not await permission or expose asynchronous startup failure.
            await core.onStartRecording();

            const current_core = read_core_recorder(this.host);
            const recorder = current_core?.recorder;

            if (current_core !== core || !current_core.recording || !recorder || recorder.state !== "recording") {
                throw new Error("Recording did not start. Check microphone access and try again; the capture note was kept.");
            }

            this.owned_core = core;
            this.owned_recorder = recorder;
            this.should_confirm_stop = false;

            if (this.is_disposed) {
                this.host.notify("Obsidian's core recorder is active. Open the audio capture note before stopping it with the core recorder controls.");

                return;
            }

            const on_stop = (): void => {
                if (this.should_confirm_stop) {
                    void this.confirm_saved_capture();
                } else {
                    this.recording_cleanup?.();
                    this.recording_cleanup = undefined;
                    this.owned_core = undefined;
                    this.owned_recorder = undefined;
                    this.owned_item_id = undefined;

                    this.set_state({
                        phase: "error",
                        message: "Recording stopped outside Inbox. Open the capture note to confirm where Obsidian saved it.",
                        item_id: result.item.id,
                    });
                }
            };

            const on_error = (): void => {
                this.set_state({
                    phase: "error",
                    message: "The core recorder reported an error. The capture note was kept.",
                    item_id: result.item.id,
                });
            };

            recorder.addEventListener(
                "stop",
                on_stop,
                { once: true },
            );

            recorder.addEventListener(
                "error",
                on_error,
            );

            this.recording_cleanup = () => {
                this.owned_recorder?.removeEventListener(
                    "stop",
                    on_stop,
                );

                this.owned_recorder?.removeEventListener(
                    "error",
                    on_error,
                );
            };

            this.set_state({
                phase: "recording",
                message: "Recording with Obsidian. Stop here to save into this capture.",
                item_id: result.item.id,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : "Audio capture could not start.";

            this.set_state({
                phase: "error",
                message,
                ...(this.owned_item_id ? { item_id: this.owned_item_id } : {}),
            });

            throw error;
        }
    }

    async stop(): Promise<void> {
        if (this.save_operation) {
            return this.save_operation;
        }

        const core = this.owned_core;
        const recorder = this.owned_recorder;
        const item_id = this.owned_item_id;

        if (!core || !recorder || !item_id || core.recorder !== recorder || !core.recording) {
            throw new Error("There is no Inbox-owned recording to stop. Use Obsidian's recorder controls for other recordings.");
        }

        this.baseline_paths = new Set((await this.host.repository.list_attachments(item_id)).map((attachment) => attachment.path));
        await this.activate_recording_note(item_id);

        if (core.recorder !== recorder || !core.recording) {
            throw new Error("The core recording changed before it could be stopped.");
        }

        this.set_state({
            phase: "saving",
            message: "Stopping and confirming the saved audio attachment.",
            item_id,
        });

        this.should_confirm_stop = true;
        core.onStopRecording();

        return this.confirm_saved_capture();
    }

    private confirm_saved_capture(): Promise<void> {
        if (this.is_disposed) {
            return Promise.resolve();
        }

        if (this.save_operation) {
            return this.save_operation;
        }

        const item_id = this.owned_item_id;

        if (!item_id) {
            return Promise.resolve();
        }

        this.set_state({
            phase: "saving",
            message: "Confirming the recording was embedded in its Inbox capture.",
            item_id,
        });

        this.save_operation = new Promise<void>((resolve) => {
            let is_finished = false;
            let is_checking = false;
            const started_at = Date.now();

            const finish = (is_saved: boolean): void => {
                if (is_finished) {
                    return;
                }

                is_finished = true;
                clearInterval(timer);
                unsubscribe();
                this.cancel_save_observation = undefined;
                this.recording_cleanup?.();
                this.recording_cleanup = undefined;
                this.owned_core = undefined;
                this.owned_recorder = undefined;
                this.owned_item_id = undefined;

                this.set_state(is_saved ? {
                    phase: "idle",
                    message: "Audio capture saved.",
                } : {
                    phase: "error",
                    message: "Recording stopped, but its save could not be confirmed. Open the capture note or Obsidian's file explorer to recover it.",
                    item_id,
                });

                resolve();
            };

            const check_saved = async (): Promise<void> => {
                if (is_finished || is_checking) {
                    return;
                }

                is_checking = true;

                try {
                    const attachments = await this.host.repository.list_attachments(item_id);
                    const saved = attachments.some((attachment) => attachment.kind === "audio" && attachment.size_bytes > 0 && !this.baseline_paths.has(attachment.path));

                    if (saved) {
                        finish(true);
                    } else if (Date.now() - started_at >= SAVE_TIMEOUT_MS) {
                        finish(false);
                    }
                } catch {
                    if (Date.now() - started_at >= SAVE_TIMEOUT_MS) {
                        finish(false);
                    }
                } finally {
                    is_checking = false;
                }
            };

            const unsubscribe = this.host.repository.subscribe(() => void check_saved());

            const timer = setInterval(
                () => void check_saved(),
                SAVE_CHECK_INTERVAL_MS,
            );

            this.cancel_save_observation = () => {
                is_finished = true;
                clearInterval(timer);
                unsubscribe();
                resolve();
            };

            void check_saved();
        }).finally(() => {
            this.save_operation = undefined;
        });

        return this.save_operation;
    }

    dispose(): void {
        this.is_disposed = true;
        this.listeners.clear();
        this.cancel_save_observation?.();
        this.cancel_save_observation = undefined;
        this.recording_cleanup?.();
        this.recording_cleanup = undefined;

        if (this.owned_core?.recording && this.owned_core.recorder === this.owned_recorder) {
            this.host.notify("Obsidian's core recorder is still active. Open the audio capture note before stopping it with the core recorder controls.");
        }
    }
}
