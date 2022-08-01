import { URL } from "url";
import Client, { IOptions } from "./connection";

import { createInterface, ReadLineOptions } from "readline";
import { Writable } from "stream";

const knownCmd = [
    "list",
    "get",
    "put",
    "append",
    "exit",
    "rename",
    "delete",
    "abort",
    "cwd",
    "status",
];

const completer = (line: string, cb: (e: Error | null, r: [string[], string]) => void) => {
    if (appConf.state) {
        const hits = knownCmd.filter((cmd) => cmd.startsWith(line));
        cb(null, [hits.length ? hits : knownCmd, line]);
    } else {
        cb(null, [[], line]);
    }
};

interface IMutableWriteable extends Writable {
    mute: string | boolean;
}

const symMute = Symbol("Mute");

// tslint:disable-next-line:variable-name
const MutableWriteable = (out: Writable): IMutableWriteable => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (out as any)[symMute] = false;
    return new Proxy(out as IMutableWriteable, {
        get(target, prop) {
            if (prop === "mute") {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return (target as any)[symMute];
            }
            if (prop === "_write") {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return function _write(chunk: any, encoding?: string, cb?: ((err?: any) => any) | undefined) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const mute = (target as any)[symMute];
                    if (mute === false) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        target._write(chunk, encoding as any, cb as any);
                    } else if (mute === true || mute === "" || (typeof chunk === "object" && !Buffer.isBuffer(chunk))) {
                        if (cb) {
                            cb();
                        }
                    } else {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        target._write(mute.repeat(chunk.length), encoding || "uft8", cb as any);
                    }
                };
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (target as any)[prop];
        },
        set(target, prop, value) {
            if (prop === "mute") {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (target as any)[symMute] = value;
                return true;
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (target as any)[prop] = value;
            return true;
        },
        has(target, prop) {
            if (prop === "mute") {
                return true;
            }
            return Object.prototype.hasOwnProperty.call(target, prop);
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
} as ReadLineOptions);

const args = process.argv.slice(2);

const appConf = {
    debug: false,
    enteredPassword: undefined as string | undefined,
    secure: undefined as string | boolean | undefined,
    state: 0,
    portAddress: undefined as string | undefined,
    portRange: undefined as string | undefined,
};

function usage(f: (l: string) => void) {
    f(
        "Usage:    ftp-ts" +
            " [--verbose]" +
            " [--implicit | --explicit | --secure-control]" +
            " [--port-addr=PORT_ADDR] [--port-range=PORT_RANGE]" +
            " [--password]" +
            " <CONNECTION>" +
            " [+FEAT0, +FEAT1..] [.FEAT0, .FEAT1..]"
    );
    f("");
    f("Flags:");
    f("  -v --verbose         Print verbose protocol information.");
    f("     --explicit        The control connection is upgraded to SSL/TLS, the data channel is also encrypted.");
    f("     --implicit        The control connection is established using SSL/TLS, the data channel is not encrypted.");
    f("     --secure-control  Like `explicit` for the control channel, except the data channel is not encrypted.");
    f("     --port-addr=PA    The IP to use for PORT commands.");
    f("     --port-range=PR   The range of port numbers to choose from for PORT commands. Default: `5000-8000`.");
    f("  -p --password        Enter the password into the CLI prompt.");
    f("");
    f("CONNECTION:");
    f("  The URI to connect to.");
    f("  If the protocol is `ftps` the `explicit` mode will be used if no other has been specified.");
    f("  ");
    f("  Example: `ftps://localhost` for an anonymous login over TLS.");
    f("  Example: `ftp://localhost` for an anonymous login without encryption.");
    f("  Example: `ftps://usera@localhost` for a user login (combine with `-p` for password).");
    f("  Example: `ftps://usera:passa@localhost` for a password login (not recommended, use `-p`).");
}

function main() {
    appConf.state = 1;
    if (!args[0]) {
        console.error("No connection string given.");
        console.error();
        usage(console.error);
        process.exit(1);
    }
    const url = new URL(args[0]);
    args.splice(0, 1);
    const opt: Partial<IOptions> = {
        host: url.hostname,
        password: typeof appConf.enteredPassword === "undefined" ? url.password : appConf.enteredPassword,
        port: url.port ? parseInt(url.port, 10) : undefined,
        secure: typeof appConf.secure === "undefined" ? url.protocol === "ftps:" : appConf.secure,
        user: url.username,
        portAddress: appConf.portAddress,
        portRange: appConf.portRange,
    };
    if (appConf.debug) {
        opt.debug = (val) => {
            console.log("ftp-ts: [VERBOSE] ", val);
        };
    }
    if (args.length) {
        opt.overrideFeats = {};
        for (const a of args) {
            if (a.startsWith("+")) {
                opt.overrideFeats[a.substring(1).toUpperCase()] = true;
            } else if (a.startsWith(".")) {
                opt.overrideFeats[a.substring(1).toUpperCase()] = false;
            }
        }
    }
    // console.log("Options: ", opt);
    // console.warn(url);
    return Client.connect(opt).then(
        (c) => {
            // console.warn((c as any)._socket);

            return new Promise<void>((res) => {
                r1.on("SIGINT", async () => {
                    try {
                        await c.logout();
                    } catch (e) {
                        r1.write(e as string);
                    }
                    process.stdin.pause();
                    res();
                });
                r1.on("line", async (line: string) => {
                    const params = line.split(" ");
                    // TODO: repare escpade spaces in string
                    const cmd = params[0];
                    if (cmd === "list") {
                        try {
                            console.dir(await c.list());
                        } catch (e) {
                            r1.write(e as string);
                        }
                    } else if (cmd === "get") {
                        const path = params[1];
                        if (path !== undefined) {
                            const compression = params[2] ? params[2] === "true" : undefined;
                            try {
                                await c.get(path, compression);
                            } catch (e) {
                                r1.write(e as string);
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
                                r1.write(e as string);
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
                                r1.write(e as string);
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
                                r1.write(e as string);
                            }
                        } else {
                            r1.write("Old and new path are needed.");
                        }
                    } else if (cmd === "logout" || cmd === "exit") {
                        try {
                            await c.logout();
                        } catch (e) {
                            r1.write(e as string);
                        }
                        process.stdin.pause();
                        r1.close();
                        res();
                    } else if (cmd === "delete") {
                        const path = params[1];
                        if (path) {
                            try {
                                await c.delete(path);
                                r1.write("Deleted " + path);
                            } catch (e) {
                                r1.write(e as string);
                            }
                        } else {
                            r1.write("Path needed to delete a file.");
                        }
                    } else if (cmd === "cwd") {
                        const path = params[1];
                        if (path) {
                            try {
                                r1.write((await c.cwd(path)) || path);
                            } catch (e) {
                                r1.write(e as string);
                            }
                        } else {
                            r1.write("Path needed to change directory.");
                        }
                    } else if (cmd === "abort") {
                        try {
                            await c.abort();
                            r1.write("Aborted.");
                        } catch (e) {
                            r1.write(e as string);
                        }
                    } else if (cmd === "site") {
                        if (params.length > 1) {
                            try {
                                await c.site(params.slice(1).join(" "));
                            } catch (e) {
                                r1.write(e as string);
                            }
                        } else {
                            r1.write("The SITE command needs a command to run.");
                        }
                    } else if (cmd === "status") {
                        try {
                            r1.write(await c.status());
                        } catch (e) {
                            r1.write(e as string);
                        }
                    } else if (cmd === "ascii") {
                        // TODO: Do
                    } else if (cmd === "binary") {
                        // TODO: Do
                    }
                });
            });
        },
        (e) => {
            if (e.message) {
                console.error(e.message);
            }
            console.error(e);
            process.stdin.pause();
            r1.close();
        }
    );
}

for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-v" || arg === "--verbose") {
        args.splice(i--, 1);
        appConf.debug = true;
    } else if (arg.startsWith("--port-range=")) {
        args.splice(i--, 1);
        appConf.portRange = arg.substring(13);
    } else if (arg.startsWith("--port-addr=")) {
        args.splice(i--, 1);
        appConf.portAddress = arg.substring(12);
    } else if (arg === "--implicit") {
        args.splice(i--, 1);
        appConf.secure = "implicit";
    } else if (arg === "--secure-control") {
        args.splice(i--, 1);
        appConf.secure = "control";
    } else if (arg === "--explicit") {
        args.splice(i--, 1);
        appConf.secure = true;
    } else if (arg === "--help") {
        args.splice(i--, 1);
        usage(console.log);
        process.exit(0);
    } else if (arg && arg[0] === "-" && arg !== "-p" && arg !== "--password") {
        args.splice(i--, 1);
        console.warn("Unrecognized argument: " + JSON.stringify(arg));
    }
}

if (args[0] === "-p" || args[0] === "--password") {
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
