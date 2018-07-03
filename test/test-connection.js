const Client = require('..').default;
const FtpServer = require('ftp-srv').FtpSrv;

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
        return new LoggerThing({ ...this.opts, ...opts});
    }

    info(...args) {
        console.info("[%s INFO]:", this.me, ...args);
    }

    trace(...args) {
        console.log("[%s TRAC]:", this.me, ...args);
    }

    debug(...args) {
        console.debug("[%s DEBG]:", this.me, ...args);
    }

    warn(...args) {
        console.warn("[%s WARN]:", this.me, ...args);
    }

    error(...args) {
        console.error("[%s ERRO]:", this.me, ...args);
    }

    fatal(...args) {
        console.error("[%s FATL]:", this.me, ...args);
    }
}

async function main() {
    console.log("Initializing FTP server");
    const server = new FtpServer("ftp://127.0.0.1:2111", { 
        // pasv_range: 2112,
        // blacklist: ["PASV"],
        greeting: "Welcome to Marathon Communication FTP",
        log: new LoggerThing({ name: "ftp-server" })
    });
    server.on("error" , (e) => console.error("FtpServer error: ", e));
    server.on("login", (data, s, r) => Promise.resolve({}).then(s, r));
    server.on("client-error", (d) => {
        console.warn("FTP client error (%s):", d.context, d.error);
    });

    await server.listen().then(() => {
        console.log("FTP Server initialized");
    }, (e) => {
        console.error("FTP server failed to initialize:", e);
    });

    // this.ftpServer.initialize(!this.conf.ftpInsecure, this.conf.ftpHost || "0.0.0.0", this.conf.ftpPort || 2111);
    const c = await Client.connect({host: "127.0.0.1", port: 2111, portAddress: "127.0.0.1", portRange: "6000-7000", debug: (s) => {
        console.warn(s)
    }/*, secure: true, secureOptions: {
        secureProtocol: "TLSv1_2_method"
    }*/});

    c.on('ready', () => {
        console.log("Client ready");
    });
    c.on("error", (e) => {
        console.error("Client error: ", e);
    });
    c.on("end", (e) => {
        console.error("Client end: ");
    });
    c.on("close", (e) => {
        console.error("Client close: ");
    });
    c.on("greeting", (e) => {
        console.error("Client greeting: ");
    });

    const res = await c.list();
    console.log("--------------------------------------------------------------");
    console.dir(res);
    const res2 = await c.list();
    console.log("--------------------------------------------------------------");
    console.dir(res2);
    console.log("--------------------------------------------------------------");
    console.dir(await Promise.all([
        c.list(),
        c.list(),
    ]));
    c.put(Buffer.from("123"),"test_file.txt");
    console.dir(await c.list());
    c.end();
    server.close();
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 20;
});