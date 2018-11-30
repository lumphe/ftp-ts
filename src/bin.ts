import { URL } from "url";
import Client, { IOptions } from "./connection";

import { createInterface } from "readline";
import { Writable } from "stream";

const knownCmd = ["list", "get", "put"];

const completer = (line: string, cb: (e: Error | null, r: [string[], string]) => void) => {
    if (appConf.state) {
        const hits = knownCmd.filter((cmd) => cmd.startsWith(line));
        cb(null, [hits.length ? hits : knownCmd, line]);
    } else {
        cb(null, [[], line]);
    }
};

interface IMutableWriteable extends Writable {
    mute: string | boolean;
}

const symMute = Symbol("Mute");

// tslint:disable-next-line:variable-name
const MutableWriteable = (out: Writable): IMutableWriteable => {
    (out as any)[symMute] = false;
    return new Proxy(out as IMutableWriteable, {
        get(target, prop) {
            if (prop === "mute") {
                return (target as any)[symMute];
            }
            if (prop === "_write") {
                return function _write(chunk: any, encoding?: string, cb?: ((err?: any) => any) | undefined) {
                    const mute = (target as any)[symMute];
                    if (mute === false) {
                        target._write(chunk, encoding as any, cb as any);
                    } else if (mute === true || mute === "" || (typeof chunk === "object" && !Buffer.isBuffer(chunk))) {
                        if (cb) {
                            cb();
                        }
                    } else {
                        target._write(mute.repeat(chunk.length), encoding || "uft8", cb as any);
                    }
                };
            }
            return (target as any)[prop];
        },
        set(target, prop, value) {
            if (prop === "mute") {
                (target as any)[symMute] = value;
                return true;
            }
            (target as any)[prop] = value;
            return true;
        },
        has(target, prop) {
            if (prop === "mute") {
                return true;
            }
            return target.hasOwnProperty(prop);
        },
    });
};

const muteWriteable = MutableWriteable(process.stdout);

const r1 = createInterface({
    completer,
    input: process.stdin,
    output: muteWriteable,
    prompt: "ftps-ts> ",
    // terminal: true,
});

const args = process.argv.slice(2);

const appConf = {
    debug: false,
    enteredPassword: undefined as string | undefined,
    secure: undefined as string | boolean | undefined,
    state: 0,
};

function main() {
    appConf.state = 1;
    const url = new URL(args[0]);
    const opt: Partial<IOptions> = {
        host: url.hostname,
        password: typeof appConf.enteredPassword === "undefined" ? url.password : appConf.enteredPassword,
        port: url.port ? parseInt(url.port, 10) : undefined,
        secure: typeof appConf.secure === "undefined" ? url.protocol === "ftps:" : appConf.secure,
        user: url.username,
    };
    if (appConf.debug) {
        opt.debug = (val) => {
            console.log("ftp-ts: [VERBOSE] ", val);
        };
    }
    // console.log("Options: ", opt);
    // console.warn(url);
    Client.connect(opt).then((c) => {

        // console.warn((c as any)._socket);

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
}

for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-v") {
        args.splice(i--, 1);
        appConf.debug = true;
    } else if (arg === "--implicit") {
        args.splice(i--, 1);
        appConf.secure = "implicit";
    } else if (arg === "--secure-control") {
        args.splice(i--, 1);
        appConf.secure = "control";
    } else if (arg === "--explicit") {
        args.splice(i--, 1);
        appConf.secure = true;
    } else if (arg && arg[0] === "-" && arg !== "-p") {
        args.splice(i--, 1);
        console.warn("Unrecognized argument: " + JSON.stringify(arg));
    }
}

if (args[0] === "-p") {
    args.splice(0, 1);

    r1.question("Password: ", (val) => {
        muteWriteable.mute = false;
        appConf.enteredPassword = val;
        muteWriteable.write("\r\n");
        main();
    });
    muteWriteable.mute = "*";
} else {
    main();
}
