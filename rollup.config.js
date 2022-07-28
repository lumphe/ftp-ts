import { terser } from "rollup-plugin-terser";
import ts from "@rollup/plugin-typescript";
import typescript from "typescript";

/** @type {import("rollup-plugin-terser").Options} */
const terserConf = {
    compress: {
        passes: 2,
        module: true,
        unsafe_arrows: true,
        unsafe_methods: true,
    },
    mangle: {
        module: true,
    },
    keep_classnames: true,
    ecma: 2017,
    module: true,
    toplevel: true,
};

/**
 * @template T
 * @param {T} o object to clone
 * @returns {T}
 */
function deepClone(o) {
    if (!o || typeof o != "object") return o;
    if (Array.isArray(o)) return o.map(deepClone);
    const r = {};
    for (const k of Object.keys(o)) {
        r[k] = deepClone(o[k]);
    }
    return r;
}

/**
 * @template {import("rollup").RollupOptions} O
 * @param {O | Readonly<O>} c config
 * @returns {O & { output: [import("rollup").OutputOptions] }}
 */
function esmConf(c) {
    c = deepClone(c);
    c.output = [
        {
            dir: "esm",
            format: "esm",
            name: "ftp-ts",
            exports: "named",
            entryFileNames: "[name].js",
            sourcemap: true,
        },
    ];
    c.plugins = [
        ts({
            typescript,
            outDir: "esm",
        }),
        terser(terserConf),
    ];
    return c;
}

/**
 * @template {import("rollup").RollupOptions} O
 * @param {O | Readonly<O>} c config
 * @returns {O & { output: [import("rollup").OutputOptions, import("rollup").OutputOptions] }}
 */
function cjsConf(c) {
    c = deepClone(c);
    c.output = [
        {
            dir: "dist",
            format: "cjs",
            name: "ftp-ts",
            exports: "named",
            entryFileNames: "[name].js",
            sourcemap: true,
        },
        {
            dir: "dist",
            format: "esm",
            name: "ftp-ts",
            exports: "named",
            entryFileNames: "[name].mjs",
            sourcemap: true,
        },
    ];
    c.plugins = [
        ts({
            typescript,
            outDir: "dist",
        }),
        terser(terserConf),
    ];
    return c;
}

/**
 * @template {import("rollup").RollupOptions & { output: [import("rollup").OutputOptions, import("rollup").OutputOptions] }} O
 * @param {O} c config
 * @returns {O}
 */
function binCjs(c) {
    c.output[0].banner = "#!/usr/bin/env node";
    c.plugins.push({
        name: "chmod",
        async writeBundle(options, bundle) {
            const chmod = (await import("fs")).chmodSync;
            for (const file of Object.keys(bundle)) {
                if (!file.endsWith(".js")) {
                    continue;
                }
                const info = bundle[file];
                let f = info.fileName;
                if (options.file) {
                    f = options.file;
                } else if (options.dir) {
                    f = options.dir + "/" + f;
                }
                // eslint-disable-next-line no-undef
                // console.log("chmod: ", {
                //     fileName: info.fileName,
                //     key: file,
                //     f: f,
                //     file: options.file,
                //     dir: options.dir,
                // });
                chmod(f, 0o755);
            }
        },
    });
    return c;
}

/**
 * @template {import("rollup").RollupOptions} C
 * @param {C} c config
 * @returns {Readonly<C>}
 */
function freezeConf(c) {
    return Object.freeze(c);
}

const libConf = freezeConf({
    input: [
        "src/connection.ts",
        "src/parser.ts",
    ],
    treeshake: true,
    external: [
        "fs",

        "tls",
        "zlib",
        "net",
        "events",
        "util",
        "stream",
        "string_decoder",
    ],
});

const binConf = freezeConf({
    input: "src/bin.ts",
    treeshake: true,
    external: [
        "fs",

        "tls",
        "zlib",
        "net",
        "events",
        "util",
        "stream",
        "string_decoder",
        "readline",
        "url",
    ],
});

export default [
    cjsConf(libConf),
    binCjs(cjsConf(binConf)),
    esmConf(libConf),
    esmConf(binConf),
];
