import { URL } from "url";
import Client from "./connection";

import { createInterface } from "readline";

const args = process.argv.slice(2);

const url = new URL(args[0]);
const opt = {
    host: url.hostname,
    password: url.password,
    port: url.port ? parseInt(url.port, 10) : undefined,
    secure: url.protocol === "ftps:",
    user: url.username,
};
// console.warn(opt);
// console.warn(url);
// TODO: read user and pass if none exists
const knownCmd = ["list", "get", "put"];
Client.connect(opt).then((c) => {
    const completer = (line: string, cb: (e: Error | null, r: [string[], string]) => void) => {
        const hits = knownCmd.filter((cmd) => cmd.startsWith(line));
        cb(null, [hits.length ? hits : knownCmd, line]);
    };
    // console.warn((c as any)._socket);
    const r1 = createInterface({
        completer,
        input: process.stdin,
        output: process.stdout,
        prompt: "ftps-ts> ",
    });
    return new Promise((res) => {
        r1.on("SIGINT", async () => {
            try {
                await c.logout();
            } catch (e) {
                r1.write(e);
            }
            process.stdin.pause();
            res();
        });
        r1.on("line", async (line) => {
            const params = line.split(" ");
            // TODO: repare escpade spaces in string
            const cmd = params[0];
            if (cmd === "list") {
                try {
                    console.dir(await c.list());
                } catch (e) {
                    r1.write(e);
                }
            } else if (cmd === "get") {
                const path = params[1];
                if (path !== undefined) {
                    const compression = params[2] ? params[2] === "true" : undefined;
                    try {
                        await c.get(path, compression);
                    } catch (e) {
                        r1.write(e);
                    }
                } else {
                    r1.write("Path are need to do get.");
                }
            } else if (cmd === "put") {
                const path = params[1];
                const dest = params[2];
                if (path !== undefined && dest !== undefined) {
                    const compression = params[2] ? params[2] === "true" : undefined;
                    try {
                        await c.put(path, dest, compression);
                    } catch (e) {
                        r1.write(e);
                    }
                } else {
                    r1.write("Path to file and destination are needed.");
                }
            } else if (cmd === "append") {
                const path = params[1];
                const dest = params[2];
                if (path !== undefined && dest !== undefined) {
                    const compression = params[2] ? params[2] === "true" : undefined;
                    try {
                        await c.append(path, dest, compression);
                    } catch (e) {
                        r1.write(e);
                    }
                } else {
                    r1.write("Path to file and destination are needed.");
                }
            } else if (cmd === "rename") {
                const oldPath = params[1];
                const newPath = params[2];
                if (oldPath !== undefined && newPath !== undefined) {
                    try {
                        await c.rename(oldPath, newPath);
                    } catch (e) {
                        r1.write(e);
                    }
                } else {
                    r1.write("Old and new path are needed.");
                }
            } else if (cmd === "logout" || cmd === "exit") {
                try {
                    await c.logout();
                } catch (e) {
                    r1.write(e);
                }
                process.stdin.pause();
                res();
            } else if (cmd === "delete") {
                const path = params[1];
                if (path) {
                    try {
                        await c.delete(path);
                    } catch (e) {
                        r1.write(e);
                    }
                } else {
                    r1.write("Path needed to delete a file.");
                }
            } else if (cmd === "cwd") {
                // TODO: Do
            } else if (cmd === "abort") {
                // TODO: Do
            } else if (cmd === "site") {
                // TODO: Do
            } else if (cmd === "status") {
                // TODO: Do
            } else if (cmd === "ascii") {
                // TODO: Do
            } else if (cmd === "binary") {
                // TODO: Do
            }
        });
    });
});
