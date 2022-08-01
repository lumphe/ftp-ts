import EventEmitter from "events";
import * as net from "net";
import { StringDecoder } from "string_decoder";
import * as tls from "tls";
import zlib from "zlib";
import Parser, { parseListEntry, parseMlsxEntry } from "./parser";

export interface IOptions {
    /**
     * The hostname or IP address of the FTP server. Default: 'localhost'
     */
    host: string;
    /**
     * The port of the FTP server. Default: 21
     */
    port: number;
    /**
     * Set to true for both control and data connection encryption, 'control' for control connection encryption only, or 'implicit' for
     * implicitly encrypted control connection (this mode is deprecated in modern times, but usually uses port 990) Default: false
     */
    secure: string | boolean;
    /**
     * Additional options to be passed to tls.connect(). Default: (none)
     */
    secureOptions?: tls.ConnectionOptions;
    /**
     * Username for authentication. Default: 'anonymous'
     */
    user: string;
    /**
     * Password for authentication. Default: 'anonymous@'
     */
    password: string;
    /**
     * How long (in milliseconds) to wait for the control connection to be established. Default: 10000
     */
    connTimeout: number;
    /**
     * How long (in milliseconds) to wait for a PASV data connection to be established. Default: 10000
     */
    pasvTimeout: number;
    /**
     * How long (in milliseconds) to wait for a PASV data connection to be established. Default: 10000
     */
    dataTimeout: number;
    /**
     * How often (in milliseconds) to send a 'dummy' (NOOP) command to keep the connection alive. Default: 10000
     */
    keepalive?: number;

    aliveTimeout: number;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    debug?: (arg: string) => any;

    portAddress?: string;

    portRange?: string;

    overrideFeats?: {
        AUTH?: false | string;
        EPRT?: boolean;
        EPSV?: boolean;
        MDTM?: boolean;
        MFMT?: boolean;
        MLST?: false | string;
        PASV?: boolean;
        SIZE?: boolean;
        UTF8?: boolean;
        [k: string]: boolean | string | undefined;
    };
}

/**
 * Element returned by Client#list()
 */
export interface IListingElement {
    acl?: boolean;
    /**
     * A single character denoting the entry type: 'd' for directory, '-' for file (or 'l' for symlink on **\*NIX only**).
     */
    type: string;
    /**
     * The name of the entry
     */
    name: string;
    /**
     * The size of the entry in bytes
     */
    size: number;
    /**
     * The last modified date of the entry
     */
    date?: Date;
    /**
     * The various permissions for this entry **(*NIX only)**
     */
    rights?: {
        /**
         * An empty string or any combination of 'r', 'w', 'x'.
         */
        user: string;
        /**
         * An empty string or any combination of 'r', 'w', 'x'.
         */
        group: string;
        /**
         * An empty string or any combination of 'r', 'w', 'x'.
         */
        other: string;
    };
    /**
     * The user name or ID that this entry belongs to **(*NIX only)**.
     */
    owner?: string;
    /**
     * The group name or ID that this entry belongs to **(*NIX only)**.
     */
    group?: string;
    /**
     * For symlink entries, this is the symlink's target **(*NIX only)**.
     */
    target?: string;
    /**
     * True if the sticky bit is set for this entry **(*NIX only)**.
     */
    sticky?: boolean;
}

export interface IRegDate {
    year?: string;
    month?: string;
    date?: string;
    hour?: string;
    minute?: string;
    second?: string;
}

interface ICallback {
    (error: Error, responseText?: string, responseCode?: number): void;
    (error: Error | undefined | null, responseText: string | undefined, responseCode: number): void;
}

interface ICurReq {
    cmd: string;
    cb: ICallback;
}

const RE_PASV = /(\d+),(\d+),(\d+),(\d+),([-\d]+),([-\d]+)/;
const RE_EPSV = /\((.)\1\1(\d+)\1\)/;
const RE_EOL = /\r?\n/g;
const RE_WD = /"(.+)"(?: |$)/;
const RE_SYST = /^([^ ]+)(?: |$)/;

const enum RETVAL {
    PRELIM = 1,
    OK = 2,
    WAITING = 3,
    ERR_TEMP = 4,
    ERR_PERM = 5,
}

const bytesNOOP = Buffer.from("NOOP\r\n");

export class FTP extends EventEmitter {
    /**
     * Static function that returns a promise to a newly connected instance.
     * @param options connect options
     * @returns a connected `FTP` instance
     */
    public static async connect(options: Partial<IOptions> = {}): Promise<FTP> {
        const ftp = new FTP();
        try {
            return await ftp.connect(options);
        } catch (e) {
            ftp.logout().catch((e) => e);
            throw e;
        }
    }

    // tslint:disable-next-line:no-object-literal-type-assertion
    public options: IOptions = {
        secure: false,
    } as IOptions;
    public connected = false;
    private _socket?: net.Socket;
    private _pasvSock?: net.Socket;
    private _pasvSocket?: net.Socket;
    private _pasvReady: Promise<void> = Promise.resolve();
    private _feat?: string[];
    private _curReq?: ICurReq;
    private _queue: ICurReq[] = [];
    private _secstate?: string; // upgraded-tls
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _debug?: (text: string) => any;
    private _keepalive?: NodeJS.Timer;
    private _ending = false;
    private _parser?: Parser;
    private readonly _detectedSupport: {
        cdup?: boolean;
        cwd?: boolean;
        eprt?: boolean;
        epsv?: boolean;
        mdtm?: boolean;
        pasv?: boolean;
        port?: boolean;
        size?: boolean;
        [k: string]: boolean | undefined;
    } = {};

    /**
     * The features the most recently connected server supports.
     */
    public get feat() {
        return this._feat;
    }

    /**
     * Connects using the options given.
     * @param options connect options
     * @returns `this` after being connected
     */
    public connect(options: Partial<IOptions> = {}): Promise<this> {
        return new Promise<this>((res, rej) => {
            let doSignal = true;
            this.connected = false;
            this.options.host = options.host || "localhost";
            this.options.port = options.port || 21;
            this.options.user = options.user || "anonymous";
            this.options.password = options.password || options.password === "" ? options.password : "anonymous@";
            this.options.secure = options.secure || false;
            this.options.secureOptions = options.secureOptions;
            this.options.connTimeout = options.connTimeout || 10000;
            this.options.dataTimeout = options.dataTimeout || options.pasvTimeout || 10000;
            this.options.aliveTimeout = options.keepalive || 10000;
            this.options.portAddress = options.portAddress;
            this.options.portRange = options.portRange;
            this.options.overrideFeats = options.overrideFeats;

            if (typeof options.debug === "function") {
                this._debug = options.debug;
            }

            const secureOptions: tls.ConnectionOptions = {};
            const debug = this._debug;
            let socket = new net.Socket();

            socket.setTimeout(0);
            socket.setKeepAlive(true);

            this._parser = new Parser({ debug });
            this._parser.on("response", (code: number, text: string) => {
                const retval = (code / 100) | 0;
                if (retval === RETVAL.ERR_TEMP || retval === RETVAL.ERR_PERM) {
                    if (this._curReq) {
                        const tempReq = this._curReq;
                        this._curReq = undefined;
                        tempReq.cb(makeError(code, text), undefined, code);
                        getLast(this._send());
                    } else {
                        const err = makeError(code, text);
                        this.emit("error", err);
                        if (doSignal) {
                            rej(err);
                            doSignal = false;
                        }
                    }
                } else if (this._curReq) {
                    const tempReq = this._curReq;
                    if (retval !== RETVAL.PRELIM) {
                        this._curReq = undefined;
                        tempReq.cb(undefined, text, code);
                        getLast(this._send());
                    } else {
                        tempReq.cb(undefined, text, code);
                    }
                }

                // a hack to signal we're waiting for a PASV data connection to complete
                // first before executing any more queued requests ...
                //
                // also: don't forget our current request if we're expecting another
                // terminating response ....
                /*if (this._curReq && retval !== RETVAL.PRELIM) {
                    this._curReq = undefined;
                    this._send();
                }*/

                noopreq.cb();
            });

            if (this.options.secure) {
                secureOptions.host = this.options.host;
                const secOpts = this.options.secureOptions;
                if (secOpts) {
                    Object.assign(secureOptions, secOpts);
                }
                secureOptions.socket = socket;
                this.options.secureOptions = secureOptions;
            }

            const noopreq = {
                cb: () => {
                    if (this._keepalive) {
                        clearTimeout(this._keepalive);
                    }
                    this._keepalive = setTimeout(donoop, this.options.aliveTimeout);
                },
                cmd: "NOOP",
            };

            const donoop = () => {
                if (!this._socket || !this._socket.writable) {
                    if (this._keepalive) {
                        clearTimeout(this._keepalive);
                        this._keepalive = undefined;
                    }
                } else if (!this._curReq && this._queue.length === 0) {
                    this._curReq = noopreq;
                    if (debug) {
                        debug("[connection] > NOOP");
                    }
                    this._socket.write(bytesNOOP);
                } else {
                    noopreq.cb();
                }
            };

            const onconnect = (): Promise<this> => {
                clearTimeout(timer);
                if (this._keepalive) {
                    clearTimeout(this._keepalive);
                    this._keepalive = undefined;
                }
                this.connected = true;
                this._socket = socket; // re-assign for implicit secure connections

                let cmd: string;

                const reentry = ([
                    code,
                    text,
                ]: [
                    number,
                    (
                        | string
                        | undefined
                    )
                ]): Promise<this> | this => {
                    /*if ((!cmd || cmd === "USER" || cmd === "PASS" || cmd === "TYPE")) {
                        this.emit("error", err);
                        if (rej) {
                            rej(err);
                            rej = null;
                        }
                        return this._socket && this._socket.end();
                    }*/
                    if (
                        (cmd === "AUTH TLS" && code !== 234 && this.options.secure !== true) ||
                        (cmd === "AUTH SSL" && code !== 334) ||
                        (cmd === "PBSZ" && code !== 200) ||
                        (cmd === "PROT" && code !== 200)
                    ) {
                        const err = new ErrorWithCode(code, "Unable to secure connection(s)");
                        this.emit("error", err);
                        if (this._socket) {
                            this._socket.end();
                        }
                        throw err;
                    }

                    if (!cmd) {
                        // sometimes the initial greeting can contain useful information
                        // about authorized use, other limits, etc.
                        this.emit("greeting", text);
                        if (this.options.secure && this.options.secure !== "implicit") {
                            cmd = "AUTH TLS";
                            return getLast(this._send(cmd, true)).then(reentry);
                        } else {
                            cmd = "USER";
                            return getLast(this._send("USER " + this.options.user, true)).then(reentry);
                        }
                    } else if (cmd === "USER") {
                        if (code !== 230) {
                            // password required
                            if (!this.options.password && this.options.password !== "") {
                                const err2 = makeError(code, "Password required");
                                this.emit("error", err2);
                                if (this._socket) {
                                    this._socket.end();
                                }
                                throw err2;
                            }
                            cmd = "PASS";
                            return getLast(this._send("PASS " + this.options.password, true)).then(reentry);
                        } else {
                            // no password required
                            cmd = "PASS";
                            return reentry([code, text]);
                        }
                    } else if (cmd === "PASS") {
                        cmd = "FEAT";
                        return getLast(this._send(cmd, true))
                            .then(
                                (a) => {
                                    if (a[1]) {
                                        this._feat = Parser.parseFeat(a[1] as string);
                                    }
                                    return a;
                                },
                                (e) => {
                                    if (e.code !== 500) {
                                        throw e;
                                    }
                                    // FEAT Not supported
                                    return [
                                        e.code,
                                        e.message,
                                    ] as [number, string];
                                }
                            )
                            .then((r) => {
                                if (!this._feat) {
                                    this._feat = [];
                                }
                                const overrideFeats = this.options.overrideFeats;
                                if (overrideFeats) {
                                    for (const k of Object.keys(overrideFeats)) {
                                        const v = overrideFeats[k];
                                        if (typeof v == "boolean") {
                                            const i = this._feat.findIndex((a) => a == k || a.startsWith(k + " "));
                                            if (i == -1 && v) {
                                                this._feat.push(k);
                                                continue;
                                            }
                                            if (i != -1 && !v) {
                                                this._feat.splice(i, 1);
                                                continue;
                                            }
                                            continue;
                                        }
                                        if (typeof v == "string") {
                                            const i = this._feat.findIndex((a) => a == k || a.startsWith(k + " "));
                                            if (i == -1) {
                                                this._feat.push(k + " " + v);
                                                continue;
                                            }
                                            this._feat[i] = k + " " + v;
                                            continue;
                                        }
                                    }
                                }
                                return r;
                            })
                            .then(reentry);
                    } else if (cmd === "FEAT") {
                        cmd = "TYPE";
                        return getLast(this._send("TYPE I", true)).then(reentry);
                    } else if (cmd === "TYPE") {
                        this.emit("ready");
                        doSignal = false;
                        return this;
                    } else if (cmd === "PBSZ") {
                        cmd = "PROT";
                        return getLast(this._send("PROT P", true)).then(reentry);
                    } else if (cmd === "PROT") {
                        cmd = "USER";
                        return getLast(this._send("USER " + this.options.user, true)).then(reentry);
                    } else if (cmd.substring(0, 4) === "AUTH") {
                        if (cmd === "AUTH TLS" && code !== 234) {
                            cmd = "AUTH SSL";
                            return getLast(this._send(cmd, true)).then(reentry);
                        } else if (cmd === "AUTH TLS") {
                            this._secstate = "upgraded-tls";
                        } else if (cmd === "AUTH SSL") {
                            this._secstate = "upgraded-ssl";
                        }
                        socket.removeAllListeners("data");
                        socket.removeAllListeners("error");
                        this._curReq = undefined; // prevent queue from being processed during
                        // TLS/SSL negotiation
                        secureOptions.socket = this._socket;
                        secureOptions.session = undefined;
                        return new Promise<this>((res2) => {
                            socket = tls.connect(secureOptions, () => res2(onconnect()));
                            socket.setEncoding("binary");
                            socket.on("data", ondata);
                            socket.once("end", onend);
                            socket.on("error", onerror);
                        });
                    } else {
                        throw new Error("No matched command: " + JSON.stringify(cmd));
                    }
                };

                const catchOnLoginError = (e: Error) => {
                    if (socket.destroyed) {
                        socket.end();
                    }
                    throw e;
                };

                if (this._secstate) {
                    if (this._secstate === "upgraded-tls" && this.options.secure === true) {
                        cmd = "PBSZ";
                        return getLast(this._send("PBSZ 0", true)).then(reentry).catch(catchOnLoginError);
                    } else {
                        cmd = "USER";
                        return getLast(this._send("USER " + this.options.user, true))
                            .then(reentry)
                            .catch(catchOnLoginError);
                    }
                } else {
                    let inRes: null | ((th: Promise<this> | this) => void) = null;
                    let inRej: null | ((err: Error) => void) = null;
                    let promRes: Promise<this> | this | null = null;
                    let promRej: undefined | null | Error;
                    const prom = new Promise<this>((res2, rej2) => {
                        inRes = res2;
                        inRej = rej2;
                        if (promRes) {
                            res2(promRes);
                        } else if (promRej !== undefined) {
                            rej2(promRej);
                        }
                    });

                    this._curReq = {
                        cb: (err: Error | undefined | null, text?: string, code?: number) => {
                            if (err) {
                                if (inRej) {
                                    inRej(err);
                                } else {
                                    promRej = err;
                                }
                            } else {
                                if (inRes) {
                                    inRes(reentry([code as number, text]));
                                } else {
                                    promRes = reentry([code as number, text]);
                                }
                            }
                        },
                        cmd: "",
                    };
                    return prom.catch(catchOnLoginError);
                }
            };

            if (this.options.secure === "implicit") {
                this._socket = tls.connect(secureOptions, () => onconnect().then(res, rej));
            } else {
                socket.once("connect", () => onconnect().then(res, rej));
                this._socket = socket;
            }

            const ondata = (chunk: Buffer) => {
                if (debug) {
                    debug("[connection] < " + chunk.toString("binary"));
                }
                (this._parser as Parser).write(chunk);
            };
            socket.on("data", ondata);

            const onerror = (err: Error) => {
                clearTimeout(timer);
                if (this._keepalive) {
                    clearTimeout(this._keepalive);
                    this._keepalive = undefined;
                }
                if (doSignal) {
                    rej(err);
                    doSignal = false;
                    if (this._socket && !this._socket.destroyed) {
                        this._socket.end();
                    }
                } else if (this.listenerCount("error")) {
                    this.emit("error", err);
                }
            };
            socket.on("error", onerror);

            const onend = () => {
                if (!hasReset) {
                    hasReset = true;
                    clearTimeout(timer);
                    this._reset();
                }
                this.emit("end");
                if (doSignal) {
                    rej("End before ready");
                    doSignal = false;
                }
            };
            socket.once("end", onend);

            socket.once("close", (err) => {
                if (!hasReset) {
                    hasReset = true;
                    clearTimeout(timer);
                    this._reset();
                }
                this.emit("close", err);
                if (doSignal) {
                    rej("Close before ready");
                    doSignal = false;
                }
            });

            let hasReset = false;

            const timer = setTimeout(() => {
                if (this.listenerCount("error") || !doSignal) {
                    this.emit("error", new Error("Timeout while connecting to server"));
                }
                if (this._socket) {
                    this._socket.destroy();
                }
                this._reset();
                if (doSignal) {
                    rej(new Error("Timeout while connecting to server"));
                    doSignal = false;
                }
            }, this.options.connTimeout);

            try {
                this._socket.connect(this.options.port, this.options.host);
            } catch (e) {
                rej(e);
            }
        });
    }

    public end(): void {
        if (this._queue.length || this._curReq) {
            this._ending = true;
        } else {
            this._reset();
        }
    }

    public destroy(): void {
        this._reset();
    }

    /**
     * Sets the transfer data type to ASCII.
     */
    public ascii(): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return getLast(this._send("TYPE A")) as Promise<any>;
    }

    /**
     * Sets the transfer data type to binary (default at time of connection).
     */
    public binary(): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return getLast(this._send("TYPE I")) as Promise<any>;
    }

    /**
     * Aborts the current data transfer (e.g. from get(), put(), or list())
     */
    public abort(immediate = true): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return getLast(this._send("ABOR", Boolean(immediate))) as Promise<any>;
    }

    /**
     * Changes the current working directory to path. callback has 2 parameters: < Error >err, < string >currentDir.
     * Note: currentDir is only given if the server replies with the path in the response text.
     */
    public cwd(path: string, promote?: boolean): Promise<string | undefined> {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        return getLast(this._send("CWD " + path, promote)).then(([_, text]) => {
            const m: undefined | "" | null | RegExpExecArray = text && RE_WD.exec(text);
            return m ? m[1] : undefined;
        });
    }

    /**
     * Delete a file on the server.
     */
    public delete(path: string): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return getLast(this._send("DELE " + path)) as Promise<any>;
    }

    /**
     * Sends command (e.g. 'CHMOD 755 foo', 'QUOTA') using SITE.
     */
    public site(command: string): Promise<[number, string | undefined]> {
        return getLast(this._send("SITE " + command));
    }

    /**
     * Retrieves human-readable information about the server's status.
     */
    public status(): Promise<string> {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        return getLast(this._send("STAT")).then(([_, text]) => text as string);
    }

    /**
     * Renames oldPath to newPath on the server
     */
    public rename(oldPath: string, newPath: string): Promise<void> {
        return getLast(this._send("RNFR " + oldPath)).then(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return getLast(this._send("RNTO " + newPath, true)) as Promise<any>;
        });
    }

    /**
     * Logout the user from the server.
     */
    public logout(): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return getLast(this._send("QUIT")) as Promise<any>;
    }

    /**
     * Optional "standard" commands (RFC 959)
     * Similar to list(), except the directory is temporarily changed to path to retrieve the directory listing.
     * This is useful for servers that do not handle characters like spaces and quotes in directory names well for the LIST command.
     * This function is "optional" because it relies on pwd() being available.
     */
    public listSafe(path?: string, useCompression?: boolean): Promise<Array<IListingElement | string>>;
    public listSafe(useCompression: boolean): Promise<Array<IListingElement | string>>;
    public async listSafe(path?: string | boolean, useCompression?: boolean): Promise<Array<IListingElement | string>> {
        if (typeof path === "string") {
            // store current path
            const origpath = await this.pwd();
            // change to destination path
            await this.cwd(path);
            // get dir listing
            try {
                return this.list(useCompression || false);
            } finally {
                if (origpath) {
                    await this.cwd(origpath);
                }
            }
        } else if (typeof path === "boolean") {
            return this.list(path);
        } else {
            return this.list();
        }
    }

    public async fileInfo(path: string): Promise<IListingElement | null> {
        const feat = this._feat || [];
        let mlst: undefined | string[] = undefined;
        if (this._detectedSupport.mlst !== false) {
            for (const f of feat) {
                if (!f.startsWith("MLST ")) {
                    continue;
                }
                const ff = f.substring(5).split(";");
                if (ff.length && !ff[ff.length - 1]) {
                    ff.pop();
                }
                mlst = ff;
                break;
            }
        }
        if (!mlst) {
            const list = await this.list(path, false);
            let item: null | IListingElement = null;
            if (list.length == 1 && typeof list[0] != "string") {
                item = list[0];
            } else {
                for (const i of list) {
                    if (typeof i == "string" || (i.name != "." && i.name != path)) {
                        continue;
                    }
                    if (item && item.name == ".") {
                        continue;
                    }
                    item = i;
                }
            }
            return item;
        }

        const [code, text] = await allow502(getLast(this._send("MLST " + path, false)));
        if (code == 502) {
            this._detectedSupport.mlst = false;
            return this.fileInfo(path);
        }
        const res = parseMlsxEntry(text || "");
        if (typeof res == "string") {
            throw new Error(res);
        }
        return res;
    }

    /**
     * Retrieves the directory listing of path.
     * @param path defaults to the current working directory.
     * @param useCompression defaults to false.
     */
    public list(path?: string, useCompression?: boolean): Promise<Array<IListingElement | string>>;
    public list(useCompression: boolean): Promise<Array<IListingElement | string>>;
    public async list(path?: string | boolean, useCompression?: boolean): Promise<Array<IListingElement | string>> {
        let cmd: string;
        const feat = this._feat || [];
        let mlst: undefined | string[] = undefined;
        if (this._detectedSupport.mlst !== false) {
            for (const f of feat) {
                if (!f.startsWith("MLST ")) {
                    continue;
                }
                const ff = f.substring(5).split(";");
                if (ff.length && !ff[ff.length - 1]) {
                    ff.pop();
                }
                mlst = ff;
                break;
            }
        }

        if (typeof path === "boolean") {
            useCompression = path;
            path = undefined;
        }
        if (path && mlst) {
            cmd = "MLSD " + path;
        } else if (path) {
            cmd = "LIST " + path;
        } else if (mlst) {
            cmd = "MLSD";
        } else {
            cmd = "LIST";
        }

        return this._pasv(async (sock) => {
            if (this._queue[0] && this._queue[0].cmd === "ABOR") {
                // sock.destroy();
                const err = new Error("Aborted");
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (err as any).code = "aborted";
                throw err;
            }

            let sockerr: Error;
            let done = false;
            let buffer = "";
            const decoder = new StringDecoder("utf8");
            let source: net.Socket | zlib.Inflate;

            if (useCompression) {
                source = zlib.createInflate();
                sock.pipe(source);
            } else {
                source = sock;
            }

            const ondone = () => {
                if (decoder) {
                    buffer += decoder.end();
                    // decoder = null;
                }
                done = true;
                final();
            };

            source.on("data", (chunk) => {
                if (typeof chunk === "string") {
                    buffer += decoder.write(Buffer.from(chunk));
                } else {
                    buffer += decoder.write(chunk);
                }
            });
            source.once("error", (err2) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                if (!(sock as any).aborting) {
                    sockerr = err2;
                }
            });
            source.once("end", ondone);
            source.once("close", ondone);

            let inRes: null | ((arr: { a: Array<IListingElement | string> }) => void) = null;
            let inRej: null | ((err: Error) => void) = null;
            let promRes: { a: Array<IListingElement | string> } | null = null;
            let promRej: undefined | null | Error;
            const prom = new Promise<{ a: Array<IListingElement | string> }>((res, rej) => {
                inRes = res;
                inRej = rej;
                if (promRes) {
                    res(promRes);
                } else if (promRej !== undefined) {
                    rej(promRej);
                }
            });

            let replies = 0;
            const sendList = async () => {
                // this callback will be executed multiple times, the first is when server
                // replies with 150 and then a final reply to indicate whether the
                // transfer was actually a success or not
                const codes = [];
                for await (const [code] of this._send(cmd, true)) {
                    // some servers may not open a data connection for empty directories
                    codes.push(code);
                    if (++replies === 1 && code === 226) {
                        replies = 2;
                    }
                }
                if (typeof path == "string" && cmd.startsWith("MLSD ") && codes[codes.length - 1] == 501) {
                    const r = await this.fileInfo(path);
                    return { a: r ? [r] : [] };
                }
                if (replies === 2) {
                    return final();
                }
                throw new Error("Expected 2 replies for list, count: " + replies + ", codes: " + codes.join(", "));
            };

            const final = () => {
                if (done && replies === 2) {
                    replies = 3;
                    if (sockerr) {
                        const err = new Error("Unexpected data connection error: " + sockerr);
                        if (inRej) {
                            inRej(err);
                        } else {
                            promRej = err;
                        }
                        throw err;
                    }
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    if ((sock as any).aborting) {
                        const err = new Error("Aborted");
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        (err as any).code = "aborted";
                        if (inRej) {
                            inRej(err);
                        } else {
                            promRej = err;
                        }
                        throw err;
                    }

                    // process received data
                    const entries = buffer.split(RE_EOL);
                    if (this._debug) {
                        this._debug("Listing entries: " + JSON.stringify(entries));
                    }
                    entries.pop(); // ending EOL
                    const parsed: Array<IListingElement | string> = [];
                    if (cmd.startsWith("MLSD")) {
                        for (let i = 0, len = entries.length; i < len; ++i) {
                            const parsedVal = parseMlsxEntry(entries[i]);
                            if (typeof parsedVal != "string") {
                                parsed.push(parsedVal);
                            } else if (this._debug) {
                                this._debug("Skipped entry listing: " + parsedVal + ": " + JSON.stringify(entries[i]));
                            }
                        }
                    } else {
                        for (let i = 0, len = entries.length; i < len; ++i) {
                            const parsedVal = parseListEntry(entries[i]);
                            if (parsedVal !== null) {
                                parsed.push(parsedVal);
                            } else if (this._debug) {
                                this._debug("Skipped entry listing: " + JSON.stringify(entries[i]));
                            }
                        }
                    }

                    const result = { a: parsed };
                    if (inRes) {
                        inRes(result);
                    } else {
                        promRes = result;
                    }
                    return Promise.resolve(result);
                }
                return prom;
            };

            if (useCompression) {
                await getLast(this._send("MODE Z", true));
                try {
                    return await sendList();
                } finally {
                    await getLast(this._send("MODE S", true));
                }
            } else {
                return sendList();
            }
        }).then((x) => x.a);
    }

    /**
     * Retrieves a file at path from the server. useCompression defaults to false
     */

    public get(path: string, useCompression?: boolean): Promise<NodeJS.ReadableStream> {
        return this._pasv(async (sock): Promise<[Promise<void>, NodeJS.ReadableStream]> => {
            if (this._queue[0] && this._queue[0].cmd === "ABOR") {
                // sock.destroy();
                const err = new Error("Aborted");
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (err as any).code = "aborted";
                throw err;
            }

            // modify behavior of socket events so that we can emit 'error' once for
            // either a TCP-level error OR an FTP-level error response that we get when
            // the socket is closed (e.g. the server ran out of space).
            let sockerr: Error;
            let started = false;
            let done = false;
            let source: net.Socket | zlib.Inflate = sock;

            if (useCompression) {
                source = zlib.createInflate();
                sock.pipe(source);
                const _emit2 = sock.emit;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                sock.emit = (ev: string | symbol, ...arg1: any[]) => {
                    if (ev === "error") {
                        if (!sockerr) {
                            sockerr = new Error(arg1.join(", "));
                        }
                        return true;
                    }
                    arg1.unshift(ev);
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    _emit2.apply<typeof sock, any[], boolean>(sock, arg1);
                    return true;
                };
            }

            let inRes: null | (() => void) = null;
            let inRej: null | ((err: Error) => void) = null;
            let promRes = false;
            let promRej: undefined | null | Error;
            const prom = new Promise<void>((res, rej) => {
                inRes = res;
                inRej = rej;
                if (promRes) {
                    res();
                } else if (promRej !== undefined) {
                    rej(promRej);
                }
            });

            const _emit = source.emit;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            source.emit = (ev: string | symbol, ...arg1: any[]) => {
                if (ev === "error") {
                    if (!sockerr) {
                        sockerr = new Error(arg1.join(", "));
                    }
                    if (inRej) {
                        inRej(sockerr);
                    } else {
                        promRej = sockerr || null;
                    }
                    return true;
                } else if (ev === "end" || ev === "close") {
                    if (!done) {
                        done = true;
                    }
                    if (inRes) {
                        inRes();
                    } else {
                        promRes = true;
                    }
                    return true;
                }
                arg1.unshift(ev);
                if (this._debug) {
                    this._debug("Get source emit: " + JSON.stringify(arg1));
                }
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                _emit.apply<typeof source, any[], boolean>(source, arg1);
                return true;
            };

            sock.pause();

            const sendRetr = () =>
                // eslint-disable-next-line no-async-promise-executor
                new Promise<[Promise<void>, NodeJS.ReadableStream]>(async (res, rej) => {
                    try {
                        const itr = await (async () => {
                            // this callback will be executed multiple times, the first is when server
                            // replies with 150, then a final reply after the data connection closes
                            // to indicate whether the transfer was actually a success or not
                            const send = this._send("RETR " + path, true);
                            // eslint-disable-next-line no-constant-condition
                            while (true) {
                                const result = await send.next();
                                if (result.done) {
                                    throw new Error("Expexted result RETR");
                                }
                                const [code] = result.value;
                                if (this._debug) {
                                    this._debug("Get code: " + code);
                                }
                                if (code === 150 || code === 125) {
                                    started = true;
                                    return send;
                                }
                            }
                        })();
                        const pres = getLast(itr).then(() => prom);
                        res([pres, source]);
                    } catch (e) {
                        rej(e);
                    }
                });

            if (useCompression) {
                await getLast(this._send("MODE Z", true));
                try {
                    return await sendRetr();
                } finally {
                    await getLast(this._send("MODE S", true));
                    const f = () => {
                        if (done) {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            _emit.call<typeof source, any[], boolean>(source, "end");
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            _emit.call<typeof source, any[], boolean>(source, "close");
                        } else if (started) {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            _emit.call<typeof source, any[], boolean>(source, "error", sockerr);
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            _emit.call<typeof source, any[], boolean>(source, "close", true);
                        }
                    };
                    prom.then(f, f);
                }
                /* return this._send("MODE Z", true).then(async () => {
                    try {
                        return await sendRetr();
                    } finally {
                        await this._send("MODE S", true);
                        const f = () => {
                            if (done && lastreply) {
                                _emit.call(source, "end");
                                _emit.call(source, "close");
                            } else if (started) {
                                _emit.call(source, "error", sockerr);
                                _emit.call(source, "close", true);
                            }
                        };
                        prom.then(f, f);
                    }
                });*/
            } else {
                try {
                    return await sendRetr();
                } finally {
                    const f = () => {
                        if (done) {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            _emit.call<typeof source, any[], boolean>(source, "end");
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            _emit.call<typeof source, any[], boolean>(source, "close");
                        } else if (started) {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            _emit.call<typeof source, any[], boolean>(source, "error", sockerr);
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            _emit.call<typeof source, any[], boolean>(source, "close", true);
                        }
                    };
                    prom.then(f, f);
                }
            }
        });
    }

    /**
     * Sends data to the server to be stored as destPath.
     * @param input can be a ReadableStream, a Buffer, or a path to a local file.
     * @param destPath
     * @param useCompression defaults to false.
     */
    public put(
        input: NodeJS.ReadableStream | Buffer | string,
        destPath: string,
        useCompression?: boolean
    ): Promise<void> {
        return this._store("STOR " + destPath, input, useCompression || false);
    }

    /**
     * Same as put(), except if destPath already exists, it will be appended to instead of overwritten.
     * @param input can be a ReadableStream, a Buffer, or a path to a local file.
     * @param destPath
     * @param useCompression defaults to false.
     */
    public append(
        input: NodeJS.ReadableStream | Buffer | string,
        destPath: string,
        useCompression?: boolean
    ): Promise<void> {
        return this._store("APPE " + destPath, input, useCompression || false);
    }

    /**
     * Optional "standard" commands (RFC 959)
     * Retrieves the current working directory
     */
    public async pwd(): Promise<string | undefined> {
        if (this._detectedSupport.pwd !== false) {
            const [code, text] = await allow502(getLast(this._send("PWD")));
            if (code != 502) {
                return text && (RE_WD.exec(text) || [])[1];
            }
        }
        this._detectedSupport.pwd = false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return this.cwd(".", true);
    }

    /**
     * Optional "standard" commands (RFC 959)
     * Changes the working directory to the parent of the current directory
     */
    public async cdup(): Promise<void> {
        if (this._detectedSupport.cdup !== false) {
            const [code] = await allow502(getLast(this._send("CDUP")));
            if (code != 502) {
                return;
            }
        }
        this._detectedSupport.cdup = false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return this.cwd("..", true) as Promise<any>;
    }

    /**
     * Optional "standard" commands (RFC 959)
     * Creates a new directory, path, on the server. recursive is for enabling a 'mkdir -p' algorithm and defaults to false
     */

    public async mkdir(path: string, recursive?: boolean): Promise<void> {
        if (!recursive) {
            await getLast(this._send("MKD " + path));
            // If not thrown it is OK!.
            return;
        }

        const cwd = await this.pwd();

        const abs = path[0] === "/";
        const owd = cwd;
        if (abs) {
            path = path.substring(1);
        }
        if (path[path.length - 1] === "/") {
            path = path.substring(0, path.length - 1);
        }
        const dirs = path.split("/");
        const dirslen = dirs.length;

        const nextDir = async (): Promise<void> => {
            let i = -1;
            let searching = true;
            if (++i === dirslen) {
                // return to original working directory
                return;
            }
            if (searching) {
                for await (const [code] of this._send("CWD " + dirs[i], true)) {
                    if (code === 550) {
                        searching = false;
                        --i;
                    }
                    return nextDir();
                }
                /*return this._send("CWD " + dirs[i], true).then(([code]) => {
                    if (code === 550) {
                        searching = false;
                        --i;
                    }
                    return nextDir();
                });*/
            } else {
                await getLast(this._send("MKD " + dirs[i], true));
                await getLast(this._send("CWD " + dirs[i], true));
                return nextDir();
                /*return this._send("MKD " + dirs[i], true).then(() => {
                    return this._send("CWD " + dirs[i], true).then(nextDir);
                });*/
            }
        };

        try {
            if (abs) {
                await getLast(this._send("CWD /", true));
                await nextDir();
                // await this._send("CWD /", true).next().then(nextDir);
            } else {
                await nextDir();
            }
        } finally {
            await getLast(this._send("CWD " + owd, true));
            // await this._send("CWD " + owd, true);
        }
    }

    /**
     * Optional "standard" commands (RFC 959)
     * Removes a directory, path, on the server. If recursive, this call will delete the contents of the directory if it is not empty
     */
    public rmdir(path: string, recursive?: boolean): Promise<void> {
        if (!recursive) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return getLast(this._send("RMD " + path)) as Promise<any>;
        }

        return this.list(path).then(async (list) => {
            // this function will be called once per listing entry
            for (const entry of list) {
                if (typeof entry === "string") {
                    throw new Error("Cannot remove when listing is string");
                }
                // get the path to the file
                let subpath = null;
                if (entry.name[0] === "/") {
                    // this will be the case when you call deleteRecursively() and pass
                    // the path to a plain file
                    subpath = entry.name;
                } else {
                    if (path[path.length - 1] === "/") {
                        subpath = path + entry.name;
                    } else {
                        subpath = path + "/" + entry.name;
                    }
                }

                // delete the entry (recursively) according to its type
                if (entry.type === "d") {
                    if (entry.name === "." || entry.name === "..") {
                        continue;
                    }
                    await this.rmdir(subpath, true);
                } else {
                    await this.delete(subpath);
                }
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return getLast(this._send("RMD " + path)) as Promise<any>;
        });
    }

    /**
     * Optional "standard" commands (RFC 959)
     * Retrieves the server's operating system.
     */
    public async system(): Promise<string> {
        const text = (await getLast(this._send("SYST")))[1];
        return (text && (RE_SYST.exec(text) || [])[1]) || "";
    }

    /**
     * Extended commands (RFC 3659)
     * Retrieves the size of path
     */
    public async size(path: string): Promise<number> {
        let code = 502;
        let text = undefined;
        if (this._detectedSupport.size !== false) {
            [code, text] = await allow502(getLast(this._send("SIZE " + path)));
        }
        if (code === 502) {
            this._detectedSupport.size = false;
            // Note: this may cause a problem as fileInfo() might be _appended_ to the queue
            return this.fileInfo(path).then((info) => {
                if (!info) {
                    throw new Error("Unable to get info for path " + JSON.stringify(path));
                }
                if (info.type == "d") {
                    throw new Error("Can not get the size of a directory");
                }
                if (info.size != -1) {
                    return info.size;
                }
                throw new Error("File not found");
            });
        }
        return text ? parseInt(text, 10) : -1;
    }

    /**
     * Retrieves the last modified date and time for `path`.
     *
     * Extensions to FTP (RFC 3659): https://datatracker.ietf.org/doc/html/rfc3659#section-3
     */
    public async lastMod(path: string): Promise<Date> {
        let code = 502;
        let text = undefined;
        if (this._detectedSupport.mdtm !== false) {
            [code, text] = await allow502(getLast(this._send("MDTM " + path)));
        }
        if (code === 502) {
            this._detectedSupport.mdtm = false;
            return this.fileInfo(path).then((info) => {
                if (info && info.date) {
                    return info.date;
                } else {
                    throw new Error("No modification time available for file " + JSON.stringify(path));
                }
            });
        }
        if (code >= 400) {
            throw Object.assign(new Error("Error for modification time (" + code + "): " + text), { code });
        }
        const val = regDate(text);
        if (!val) {
            throw new Error("Invalid date/time format from server");
        }
        const ret = new Date(
            val.year + "-" + val.month + "-" + val.date + "T" + val.hour + ":" + val.minute + ":" + val.second
        );
        return ret;
    }

    /**
     * Sets the file byte offset for the next file transfer action (get/put) to `byteOffset`.
     *
     * Extensions to FTP (RFC 3659): https://datatracker.ietf.org/doc/html/rfc3659#section-3
     */
    public restart(byteOffset: number): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return getLast(this._send("REST " + byteOffset)) as Promise<any>;
    }

    /**
     * This method may be overridden on the instance to allow for better managed `PORT`/`EPRT` commands.
     *
     * For example, you may wish to bind only to a specific network interface for security reasons.
     * In that case you may override this method to return the `bindIp` with a value of `127.0.0.1` instead of `0.0.0.0` to only allow incoming connections from localhost.
     *
     * Another reason may be to decide upon a port number and `await` some NAT rules to propagate before the remote server connects.
     *
     * This could also be useful if your external IP family does not match the family of your interface due to proxying or NAT rules.
     * By default the zero `bindIp` will always be in the same IP family as the external IP set as `portAddress` in the `IOption` object.
     *
     * @param bindIp the ip for the interface
     * @param portRange a suggested port range, usually provided from the configuration option
     * @returns an async tuple containing the (possibly changed) `bindIp` and a `portRange`/`portNumber`; unless overridden the `bindIp` is `0.0.0.0` or `::`
     */
    public localPort(
        bindIp: string,
        portRange?: string
    ): [string, string | number] | Promise<[string, string | number]> {
        const addrFam = net.isIP(bindIp);
        if (addrFam == 0) {
            throw new Error("Invalid IP: " + bindIp);
        }
        bindIp = addrFam == 4 ? "0.0.0.0" : "::";
        return [bindIp, portRange || "5000-8000"];
    }

    private async _pasv<T>(func: (con: net.Socket) => Promise<T | [Promise<void>, T]>): Promise<T> {
        let first = true;
        let ip: string;
        let port: number;

        const computePasvCommand = () => {
            const feat = this._feat || [];
            if (
                (feat.length == 0 ||
                    feat.includes("EPSV") ||
                    ![undefined, "IPv4"].includes(this._socket?.remoteFamily)) &&
                this._detectedSupport.epsv !== false
            ) {
                return "EPSV";
            } else if (
                (feat.length == 0 || feat.includes("PASV")) &&
                this._detectedSupport.pasv !== false &&
                [undefined, "IPv4"].includes(this._socket?.remoteFamily)
            ) {
                return "PASV";
            } else {
                return "";
            }
        };

        let pasvCommand = "";

        const pasvReentry = async ([
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            code,
            text,
        ]: [
            number,
            (
                | string
                | undefined
            )
        ]): Promise<net.Socket> => {
            this._curReq = undefined;

            if (first && (!pasvCommand || pasvCommand == "PASV")) {
                const m = text && RE_PASV.exec(text);
                if (!m) {
                    throw new Error("Unable to parse PASV server response");
                }
                ip = m[1];
                ip += ".";
                ip += m[2];
                ip += ".";
                ip += m[3];
                ip += ".";
                ip += m[4];
                port = (parseInt(m[5], 10) << 8) | parseInt(m[6], 10);
                first = false;
            } else if (first) {
                const m = text && RE_EPSV.exec(text);
                if (!m) {
                    throw new Error("Unable to parse EPSV server response");
                }
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                ip = this._socket!.remoteAddress as string;
                port = parseInt(m[2], 10);
                first = false;
            }
            const sock = await this._pasvConnect(ip, port).catch((err2) => {
                // try the IP of the control connection if the server was somehow
                // misconfigured and gave for example a LAN IP instead of WAN IP over
                // the Internet
                if (this._socket && ip !== this._socket.remoteAddress) {
                    ip = this._socket.remoteAddress as string;
                    return pasvReentry([0, ""]);
                }

                // automatically abort PASV mode
                const send2 = getLast(this._send("ABOR", true));
                return send2.then(() => {
                    getLast(this._send());
                    throw err2;
                });
            });

            getLast(this._send());
            return sock;
        };

        const reentryPort = async (server: net.Server) => {
            const sock = await this._portConnect(server).catch((err2) => {
                // automatically abort PORT mode
                const send2 = getLast(this._send("ABOR", true));
                return send2.then(() => {
                    getLast(this._send());
                    throw err2;
                });
            });

            getLast(this._send());
            return sock;
        };

        const pasvOrPort = async (): Promise<[Promise<void>, T]> => {
            const portAddress = this.options.portAddress;
            pasvCommand = computePasvCommand();
            if (pasvCommand || !portAddress) {
                return getLast(this._send(pasvCommand || "PASV")).then(
                    async (send) => {
                        const sock = await pasvReentry(send);
                        const res = await func(sock);

                        if (Array.isArray(res)) {
                            return [
                                res[0].then(
                                    () => sock.destroy(),
                                    () => sock.destroy()
                                ),
                                res[1],
                            ];
                        }
                        sock.destroy();
                        return [Promise.resolve(), res];
                    },
                    (err: Error & { code: number }) => {
                        if ((err.code == 500 || err.code == 502) && pasvCommand) {
                            if (pasvCommand == "PASV") {
                                this._detectedSupport.pasv = false;
                            } else if (pasvCommand == "EPSV") {
                                this._detectedSupport.epsv = false;
                            }
                        }
                        if (!portAddress && !pasvCommand) {
                            throw err;
                        }
                        return pasvOrPort();
                    }
                );
            } else {
                const addrFam0 = net.isIP(portAddress) as 0 | 4 | 6;
                if (addrFam0 != 4 && addrFam0 != 6) {
                    throw new Error("Invalid `portAddress`, must be IPv4 or IPv6: " + JSON.stringify(portAddress));
                }
                const [bindIp, portRange] = await this.localPort(portAddress, this.options.portRange);
                const addrFam = net.isIP(bindIp) as 0 | 4 | 6;
                if (addrFam != 4 && addrFam != 6) {
                    throw new Error("Invalid `bindIp`, must be IPv4 or IPv6: " + JSON.stringify(bindIp));
                }
                if (
                    addrFam != 4 &&
                    (!this._feat || !this._feat.includes("EPRT") || this._detectedSupport.eprt === false)
                ) {
                    throw new Error(
                        "Only IPv4 may be used for `bindIp` when connecting to servers without `EPRT` support"
                    );
                }
                const server = await createServer(portRange || "5000-8000", bindIp);
                const tempsock = reentryPort(server);
                const address = server.address();
                const tempport = typeof address !== "string" ? address.port : 0;
                let portCommand;
                if (addrFam == 4) {
                    const portByte1 = tempport >> 8;
                    const portByte2 = tempport & 0xff;
                    portCommand = "PORT " + portAddress.replace(/\./g, ",") + "," + portByte1 + "," + portByte2;
                } else {
                    portCommand = "EPRT |2|" + portAddress + "|" + tempport + "|";
                }
                await getLast(this._send(portCommand));
                const sock = await tempsock;
                const res = await func(sock).catch((err) => {
                    throw err;
                });
                if (Array.isArray(res)) {
                    return [
                        res[0].then(
                            () => sock.destroy(),
                            () => sock.destroy()
                        ),
                        res[1],
                    ];
                }
                sock.destroy();
                return [Promise.resolve(), res];
            }
        };

        const ret = this._pasvReady.then(pasvOrPort);

        this._pasvReady = ret.then(
            (a) => a[0],
            () => undefined
        );
        return ret.then((b) => {
            return b[1];
        });
    }

    private _portConnect(server: net.Server): Promise<net.Socket> {
        return new Promise<net.Socket>((res, rej) => {
            let sockerr: Error | null = null;
            let timedOut = false;
            const timer = setTimeout(() => {
                timedOut = true;
                server.close();
                rej(new Error("Timed out while making data connection"));
            }, this.options.dataTimeout);

            server.on("connection", (socket) => {
                this._pasvSocket = socket;
                clearTimeout(timer);
                if (this._debug) {
                    this._debug("[connection] PORT socket connected");
                }

                socket.once("error", (err) => {
                    sockerr = err;
                    rej(sockerr);
                });
                socket.once("close", () => {
                    if (!this._pasvSocket && !timedOut) {
                        let errmsg = "Unable to make data connection";
                        if (sockerr) {
                            errmsg += "( " + sockerr + ")";
                            sockerr = null;
                        }
                        rej(new Error(errmsg));
                    }
                    this._pasvSocket = undefined;
                    server.close();
                });
                res(socket);
            });

            server.on("error", rej);
            server.on("close", () => {
                if (!this._pasvSocket && !timedOut) {
                    let errmsg = "Unable to make data connection";
                    if (sockerr) {
                        errmsg += "( " + sockerr + ")";
                        sockerr = null;
                    }
                    rej(new Error(errmsg));
                }
                this._pasvSocket = undefined;
            });
        });
    }

    private _pasvConnect(ip: string, port: number): Promise<net.Socket> {
        return new Promise<net.Socket>((res, rej) => {
            let socket = new net.Socket();
            let sockerr: Error | null = null;
            let timedOut = false;
            const timer = setTimeout(() => {
                timedOut = true;
                socket.destroy();
                rej(new Error("Timed out while making data connection"));
            }, this.options.dataTimeout);

            socket.setTimeout(0);

            socket.once("connect", () => {
                if (this._debug) {
                    this._debug("[connection] PASV socket connected");
                }
                if (this.options.secure === true) {
                    this.options.secureOptions = this.options.secureOptions || {};
                    this.options.secureOptions.socket = socket;
                    this.options.secureOptions.session = (this._socket as tls.TLSSocket).getSession();
                    // socket.removeAllListeners('error');
                    socket = tls.connect(this.options.secureOptions);
                    // socket.once('error', onerror);
                    socket.setTimeout(0);
                }
                clearTimeout(timer);
                this._pasvSocket = socket;
                res(socket);
            });

            socket.once("error", (err) => {
                sockerr = err;
                rej(sockerr);
            });
            socket.once("end", () => {
                clearTimeout(timer);
            });
            socket.once("close", () => {
                clearTimeout(timer);
                if (!this._pasvSocket && !timedOut) {
                    let errmsg = "Unable to make data connection";
                    if (sockerr) {
                        errmsg += "( " + sockerr + ")";
                        sockerr = null;
                    }
                    rej(new Error(errmsg));
                }
                this._pasvSocket = undefined;
            });

            socket.connect(port, ip);
        });
    }

    private _store(
        cmd: string,
        input: NodeJS.ReadableStream | Buffer | string,
        useCompression?: boolean
    ): Promise<void> {
        if (!Buffer.isBuffer(input) && typeof input !== "string" && input.pause !== undefined) {
            input.pause();
        }

        return this._pasv(async (sock) => {
            if (this._queue[0] && this._queue[0].cmd === "ABOR") {
                const e = new Error("Aborted");
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (e as any).code = "aborted";
                throw e;
            }

            let sockerr: Error | null = null;
            sock.once("error", (err2) => {
                sockerr = err2;
            });

            const sendStore = async (dest: net.Socket | zlib.Deflate): Promise<void> => {
                // this callback will be executed multiple times, the first is when server
                // replies with 150, then a final reply after the data connection closes
                // to indicate whether the transfer was actually a success or not
                for await (const [code] of this._send(cmd, true)) {
                    // const [code] = await this._send(cmd, true);
                    if (code === 150 || code === 125) {
                        if (Buffer.isBuffer(input)) {
                            dest.write(input);
                            dest.end();
                        } else if (typeof input === "string") {
                            // check if input is a file path or just string data to store
                            await import("fs").then((fs) => {
                                fs.stat(input, (err3 /*, stats */) => {
                                    if (err3) {
                                        // dest.write(input);
                                        dest.end();
                                    } else {
                                        fs.createReadStream(input).pipe(dest);
                                    }
                                });
                            });
                        } else {
                            input.pipe(dest);
                            input.resume();
                        }
                    }
                }
            };

            try {
                if (useCompression) {
                    await getLast(this._send("MODE Z", true));
                    // draft-preston-ftpext-deflate-04 says min of 8 should be supported
                    const dest = zlib.createDeflate({ level: 8 });
                    try {
                        dest.pipe(sock);
                        return sendStore(dest);
                    } finally {
                        dest.end();
                        await getLast(this._send("MODE S", true));
                    }
                } else {
                    return sendStore(sock);
                }
            } catch (e) {
                throw e || sockerr;
            }
        });
    }

    private readonly _send = async function* (
        this: FTP,
        cmd?: string,
        promote?: boolean
    ): AsyncIterableIterator<[number, string | undefined]> {
        let promRes: [number, string | undefined] | null = null;
        let promRej: Error | null = null;
        let res: ((v: [number, string | undefined]) => void) | null = null;
        let rej: ((e: Error) => void) | null = null;

        if (this._keepalive) {
            clearTimeout(this._keepalive);
            this._keepalive = undefined;
        }
        if (cmd !== undefined) {
            const callback: ICallback = (
                err: Error | undefined | null,
                text: string | undefined,
                num: number | undefined
            ) => {
                if (err) {
                    if (rej) {
                        rej(err);
                    } else {
                        promRej = err;
                    }
                } else {
                    if (res) {
                        res([num as number, text]);
                    } else {
                        promRes = [num as number, text];
                    }
                }
            };
            if (promote) {
                this._queue.unshift({ cmd, cb: callback });
            } else {
                this._queue.push({ cmd, cb: callback });
            }
        }
        const queueLen = this._queue.length;
        if (!this._curReq && queueLen && this._socket && this._socket.readable) {
            this._curReq = this._queue.shift() as ICurReq;
            if (this._curReq.cmd === "ABOR" && this._pasvSocket) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (this._pasvSocket as any).aborting = true;
            }
            if (this._debug) {
                this._debug("[connection] > " + this._curReq.cmd);
            }
            this._socket.write(this._curReq.cmd + "\r\n");
        } else if (!this._curReq && !queueLen && this._ending) {
            this._reset();
        }

        let isLast = false;
        while (!isLast) {
            const prom = new Promise<[number, string | undefined]>((ires, irej) => {
                res = ires;
                rej = irej;
                if (promRes) {
                    res(promRes);
                } else if (promRej !== null) {
                    rej(promRej);
                }
            });
            const v = await prom;
            res = null;
            rej = null;
            promRes = null;
            promRej = null;
            isLast = this._curReq === undefined;
            yield v;
        }
    };

    private _reset(): void {
        if (this._pasvSock && this._pasvSock.writable) {
            this._pasvSock.end();
        }
        if (this._socket && this._socket.writable) {
            this._socket.end();
        }
        this._socket = undefined;
        this._pasvSock = undefined;
        this._feat = undefined;
        this._curReq = undefined;
        this._secstate = undefined;
        if (this._keepalive) {
            clearTimeout(this._keepalive);
            this._keepalive = undefined;
        }
        this._queue = [];
        this._ending = false;
        this._parser = undefined;
        this.options.host =
            this.options.port =
            this.options.user =
            this.options.password =
            this.options.secure =
            this.options.connTimeout =
            this.options.dataTimeout =
            this.options.keepalive =
            this._debug =
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                undefined as any;
        this.connected = false;
    }
}

export class ErrorWithCode extends Error {
    public readonly code: number;
    public constructor(code: number, text: string) {
        super(text || "" + code);
        this.code = code;
    }
}

// Utility functions
function makeError(code: number, text: string): ErrorWithCode {
    return new ErrorWithCode(code, text);
}

const regDatePattern = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d+)(?:.\d+)?$/;
function regDate(text: string | undefined): IRegDate | undefined {
    // "^(?<year>\\d{4})(?<month>\\d{2})(?<date>\\d{2})(?<hour>\\d{2})(?<minute>\\d{2})(?<second>\\d+)(?:.\\d+)?$"
    const temp = text && text.match(regDatePattern);
    if (!temp) {
        return undefined;
    }
    return {
        date: temp[3],
        hour: temp[4],
        minute: temp[5],
        month: temp[2],
        second: temp[6],
        year: temp[1],
    };
}

async function allow502(itr: Promise<[number, string | undefined]>): Promise<[number, string | undefined]> {
    try {
        return await itr;
    } catch (e) {
        if (e instanceof ErrorWithCode && (e.code == 500 || e.code == 502)) {
            return [502, e.message];
        }
        throw e;
    }
}

async function getLast<T>(itr: AsyncIterator<T>): Promise<T> {
    let temp;
    let tempVal;
    do {
        temp = await itr.next();
        if (!temp.done || temp.value) {
            tempVal = temp.value;
        }
    } while (!temp.done);
    return tempVal as T;
}

function createServer(portRange: string | number, ip?: string): Promise<net.Server> {
    return new Promise<net.Server>((res, rej) => {
        if (portRange) {
            // let socket: net.Socket;
            const s = net.createServer(/*{pauseOnConnect: true}*/);
            let [min, max] =
                typeof portRange === "string"
                    ? (portRange.split("-", 2).map((v) => (v ? parseInt(v, 10) : 0)) as [number, number])
                    : [portRange, portRange];
            if (!min) {
                min = 1;
            }
            if (!max || max > 65535) {
                max = 65535;
            }
            s.maxConnections = 1;
            const errf = () => {
                if (min < max) {
                    min++;
                    s.listen(min, ip);
                } else {
                    rej(new Error("Unable to find available port"));
                }
            };
            s.on("error", errf);
            s.on("listening", () => {
                s.removeListener("error", errf);
                // res([s, socket]);
                res(s);
            });
            s.listen(min, ip);
        } else {
            rej(new Error("Invalid `portRange`"));
        }
    });
}

export default FTP;
