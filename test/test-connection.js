/* eslint-disable @typescript-eslint/no-var-requires */
// eslint-disable-next-line no-undef
require("source-map-support/register");
// eslint-disable-next-line no-undef
const Client = require("..").default;
// eslint-disable-next-line no-undef
const FtpServer = require("ftp-srv").FtpSrv;
// eslint-disable-next-line no-undef
const createWriteStream = require("fs").createWriteStream;
// eslint-disable-next-line no-undef
const statSync = require("fs").statSync;

class LoggerThing {
    constructor(opts) {
        this.opts = opts;
    }

    get me() {
        const r = [];
        for (const k of Object.keys(this.opts)) {
            r.push(k + ": " + JSON.stringify(this.opts[k]));
        }
        return r.join(", ");
    }

    child(opts) {
        return new LoggerThing({ ...this.opts, ...opts });
    }

    info(...args) {
        // eslint-disable-next-line no-undef
        console.info("[%s INFO]:", this.me, ...args);
    }

    trace(...args) {
        // eslint-disable-next-line no-undef
        console.log("[%s TRAC]:", this.me, ...args);
    }

    debug(...args) {
        // eslint-disable-next-line no-undef
        console.debug("[%s DEBG]:", this.me, ...args);
    }

    warn(...args) {
        // eslint-disable-next-line no-undef
        console.warn("[%s WARN]:", this.me, ...args);
    }

    error(...args) {
        // eslint-disable-next-line no-undef
        console.error("[%s ERRO]:", this.me, ...args);
    }

    fatal(...args) {
        // eslint-disable-next-line no-undef
        console.error("[%s FATL]:", this.me, ...args);
    }
}
/**
 *
 * @param {NodeJS.ReadableStream} input
 * @param {NodeJS.WritableStream} output
 */
function pipeall(input, output) {
    return new Promise((res, rej) => {
        output.once("error", (e) => {
            // eslint-disable-next-line no-undef
            console.warn("PipeAll.output: error event ", e);
            rej(e);
        });
        input.once("error", (e) => {
            // eslint-disable-next-line no-undef
            console.warn("PipeAll.input: error event ", e);
            rej(e);
        });
        output.once("close", () => {
            // eslint-disable-next-line no-undef
            console.log("PipeAll.output: close event ");
            res();
        });
        input.pipe(output);
    });
}

async function main() {
    // eslint-disable-next-line no-undef
    console.log("Initializing FTP server");
    const server = new FtpServer({
        url: "ftp://127.0.0.1:2111",
        // pasv_min: 2112,
        // pasv_max: 2112,
        // blacklist: ["PASV"],
        greeting: "Welcome to FTP-TS example Communication FTP",
        log: new LoggerThing({ name: "ftp-server" }),
    });
    // eslint-disable-next-line no-undef
    server.on("error", (e) => console.error("FtpServer error: ", e));
    server.on("login", (d, s, r) =>
        (async (data) => {
            if (data.username !== "invalid" && data.password !== "invalid") {
                return {};
            }
            throw new Error("User was invalid");
        })(d).then(s, r)
    );
    server.on("client-error", (d) => {
        // eslint-disable-next-line no-undef
        console.warn("FTP client error (%s):", d.context, d.error);
    });

    await server.listen().then(
        () => {
            // eslint-disable-next-line no-undef
            console.log("FTP Server initialized");
        },
        (e) => {
            // eslint-disable-next-line no-undef
            console.error("FTP server failed to initialize:", e);
        }
    );

    await Client.connect({
        host: "bla bla bla",
        port: 2111,
        portAddress: "127.0.0.1",
        portRange: "6000-7000",
        debug: (s) => {
            // eslint-disable-next-line no-undef
            console.warn(s);
        },
    }).then(
        (c) => {
            c.end();
            // eslint-disable-next-line no-undef
            console.error("Successfully connected to 'bla bla bla', this should not happen.");
            // eslint-disable-next-line no-undef
            process.exitCode = 4;
        },
        (e) => {
            if (e.code === "ENOTFOUND") {
                // eslint-disable-next-line no-undef
                console.log("Success in ENOTFOUND test.");
                return;
            }
            // eslint-disable-next-line no-undef
            console.error("Unexpected error while connecting to 'bla bla bla':", e);
            // eslint-disable-next-line no-undef
            process.exitCode = 4;
        }
    );

    await Client.connect({
        host: "127.0.0.1",
        port: 2111,
        portAddress: "127.0.0.1",
        portRange: "6000-7000",
        user: "invalid",
        password: "invalid",
        debug: (s) => {
            // eslint-disable-next-line no-undef
            console.warn(s);
        },
    }).then(
        (c) => {
            c.end();
            // eslint-disable-next-line no-undef
            console.error(
                "Successfully connected to 127.0.0.1 with user invalid and passoword invalid, this should not happen."
            );
            // eslint-disable-next-line no-undef
            process.exitCode = 4;
        },
        (e) => {
            if (e.code === 530) {
                // eslint-disable-next-line no-undef
                console.log("Success in Invalid user test.");
                return;
            }
            // eslint-disable-next-line no-undef
            console.error("Unexpected error while connecting to '127.0.0.1':", e);
            // eslint-disable-next-line no-undef
            process.exitCode = 4;
        }
    );

    // this.ftpServer.initialize(!this.conf.ftpInsecure, this.conf.ftpHost || "0.0.0.0", this.conf.ftpPort || 2111);
    const c = await Client.connect({
        host: "127.0.0.1",
        port: 2111,
        portAddress: "127.0.0.1",
        portRange: "6000-7000",
        debug: (s) => {
            // eslint-disable-next-line no-undef
            console.warn(s);
        },
        //secure: true,
        //secureOptions: { secureProtocol: "TLSv1_2_method" },
    });

    c.on("ready", () => {
        // eslint-disable-next-line no-undef
        console.log("Client ready");
    });
    c.on("error", (e) => {
        // eslint-disable-next-line no-undef
        console.error("Client error: ", e);
    });
    c.on("end", (e) => {
        // eslint-disable-next-line no-undef
        console.error("Client end: ");
    });
    c.on("close", (e) => {
        // eslint-disable-next-line no-undef
        console.error("Client close: ");
    });
    c.on("greeting", (e) => {
        // eslint-disable-next-line no-undef
        console.error("Client greeting: ");
    });

    const res = await c.list();
    // eslint-disable-next-line no-undef
    console.log("--------------------------------------------------------------");
    // eslint-disable-next-line no-undef
    console.dir(res);
    const res2 = await c.list();
    // eslint-disable-next-line no-undef
    console.log("--------------------------------------------------------------");
    // eslint-disable-next-line no-undef
    console.dir(res2);
    // eslint-disable-next-line no-undef
    console.log("--------------------------------------------------------------");
    // eslint-disable-next-line no-undef
    console.dir(
        await Promise.all([
            c.list(),
            c.list(),
        ])
    );
    // eslint-disable-next-line no-undef
    c.put(Buffer.from("123"), "test_file.txt");
    // eslint-disable-next-line no-undef
    console.dir(await c.list());
    c.end();

    // eslint-disable-next-line no-undef
    console.log(
        "----------------------------------------------------------------------------------------------------------------------------"
    );

    await Client.connect({
        host: "127.0.0.1",
        port: 2111,
        portAddress: "127.0.0.1",
        portRange: "6000-7000",
        debug: (s) => {
            // eslint-disable-next-line no-undef
            console.warn(s);
        },
    }).then(async (c) => {
        const stream = await c.get("LICENSE");
        const writeStream = createWriteStream("test_LICENSE.txt");
        // eslint-disable-next-line no-undef
        console.log("---------------- Bytes Readpre: ", stream.bytesRead);
        await pipeall(stream, writeStream);
        // eslint-disable-next-line no-undef
        console.log("---------------- Bytes Readpost: ", stream.bytesRead);
        writeStream.end();
        // eslint-disable-next-line no-undef
        console.log("---------------- bytesWritten: ", writeStream.bytesWritten);
        c.end();
        const org = statSync("LICENSE");
        const tst = statSync("test_LICENSE.txt");
        if (org.size !== tst.size) {
            throw new Error("Retrieved file are not the same.");
        }
    });

    server.close();
}

main().catch((e) => {
    // eslint-disable-next-line no-undef
    console.error(e);
    // eslint-disable-next-line no-undef
    process.exitCode = 20;
});
