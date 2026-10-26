import { spawn } from "node:child_process";

const WORKSPACES = ["@beautiful/design", "@beautiful/inbox"];
const CHILDREN = WORKSPACES.map((workspace) => spawn(
    process.execPath,
    [process.env.npm_execpath, "run", "dev", `--workspace=${workspace}`],
    { stdio: "inherit" },
));
let is_stopping = false;

function stop_children(exit_code) {
    if (is_stopping) {
        return;
    }

    is_stopping = true;

    for (const child of CHILDREN) {
        child.kill("SIGTERM");
    }

    process.exitCode = exit_code;
}

for (const child of CHILDREN) {
    child.on(
        "exit",
        (exit_code) => stop_children(exit_code ?? 1),
    );
    child.on(
        "error",
        () => stop_children(1),
    );
}

process.on(
    "SIGINT",
    () => stop_children(0),
);
process.on(
    "SIGTERM",
    () => stop_children(0),
);
