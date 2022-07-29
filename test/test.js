// eslint-disable-next-line no-undef, @typescript-eslint/no-var-requires
var readdirSync = require("fs").readdirSync;

// eslint-disable-next-line no-undef
readdirSync(__dirname).forEach(function (f) {
    if (f.substring(0, 5) === "test-") {
        // eslint-disable-next-line no-undef
        require("./" + f);
        // eslint-disable-next-line no-undef
        console.log("%s done", f);
    }
});
