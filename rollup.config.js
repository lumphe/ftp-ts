import resolve from 'rollup-plugin-node-resolve';
import uglify from 'rollup-plugin-uglify';
import commonjs from 'rollup-plugin-commonjs';

export default [{
    experimentalCodeSplitting: true,
    experimentalDynamicImport: true,
    input: [
        "esm/connection.js",
        "esm/parser.js",
    ],
    output: [
        {
            dir: "dist",
            format: "cjs",
            name: "node-ftp",
            exports: "named",
            sourcemap: true
        }
    ],
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
    plugins: [
        resolve(),
        uglify(),
        commonjs()
    ]
},{
    experimentalCodeSplitting: true,
    experimentalDynamicImport: true,
    input: [
        "esm/bin.js",
    ],
    output: [
        {
            banner: "#!/usr/bin/env node",
            dir: "dist",
            format: "cjs",
            name: "node-ftp",
            exports: "named",
            sourcemap: true
        }
    ],
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
    plugins: [
        resolve(),
        uglify(),
        commonjs()
    ]
}
];
