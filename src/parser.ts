import { Writable as WritableStream } from "stream";
import { IListingElement } from "./connection";

// const XRegExp = require('xregexp').XRegExp;

// const REX_LISTUNIX = XRegExp.cache("^(?<type>[\\-ld])(?<permission>([\\-r][\\-w][\\-xstT]){3})(?<acl>(\\+))?\\s+(?<inodes>\\d+)\\s+(?<owner>\\S+)\\s+(?<group>\\S+)\\s+(?<size>\\d+)\\s+(?<timestamp>((?<month1>\\w{3})\\s+(?<date1>\\d{1,2})\\s+(?<hour>\\d{1,2}):(?<minute>\\d{2}))|((?<month2>\\w{3})\\s+(?<date2>\\d{1,2})\\s+(?<year>\\d{4})))\\s+(?<name>.+)$");
// const REX_LISTMSDOS = XRegExp.cache("^(?<month>\\d{2})(?:\\-|\\/)(?<date>\\d{2})(?:\\-|\\/)(?<year>\\d{2,4})\\s+(?<hour>\\d{2}):(?<minute>\\d{2})\\s{0,1}(?<ampm>[AaMmPp]{1,2})\\s+(?:(?<size>\\d+)|(?<isdir>\\<DIR\\>))\\s+(?<name>.+)$");
const RE_ENTRY_TOTAL = /^total/;
const RE_RES_END = /(?:^|\r?\n)(\d{3}) [^\r\n]*\r?\n/;
const RE_EOL = /\r?\n/g;
const RE_DASH = /\-/g;

// TODO:  CHANGE TO MAP
const MONTHS = new Map([
    ["jan", 1],
    ["feb", 2],
    ["mar", 3],
    ["apr", 4],
    ["may", 5],
    ["jun", 6],
    ["jul", 7],
    ["aug", 8],
    ["sep", 9],
    ["oct", 10],
    ["nov", 11],
    ["dec", 12],
]);

// type NamedRegexpArray = RegExpExecArray & { [k: string]: string; };

export default class Parser extends WritableStream {

    public static parseFeat(text: string): string[] {
        const lines = text.split(RE_EOL);
        lines.shift(); // initial response line
        lines.pop(); // final response line

        for (let i = 0, len = lines.length; i < len; ++i) {
            lines[i] = lines[i].trim();
        }

        // just return the raw lines for now
        return lines;
    }

    public static parseListEntry(line: string) {
        // var ret, info, month, day, year, hour, mins;
        let ret: IListUnix | IListMsDos | null;
        // tslint:disable-next-line:no-conditional-assignment
        if ((ret = regListUnix(line))) {
            let name;
            let target: string | undefined;
            if (ret.type === "l") {
                const pos = ret.name.indexOf(" -> ");
                name = ret.name.substring(0, pos);
                target = ret.name.substring(pos + 4);
            } else {
                name = ret.name;
            }
            const info: IListingElement = {
                acl: (ret.acl === "+"),
                date: undefined,
                group: ret.group,
                name,
                owner: ret.owner,
                rights: {
                    group: ret.permission.substr(3, 3).replace(RE_DASH, ""),
                    other: ret.permission.substr(6, 3).replace(RE_DASH, ""),
                    user: ret.permission.substr(0, 3).replace(RE_DASH, ""),
                },
                size: parseInt(ret.size, 10),
                sticky: false,
                target,
                type: ret.type,
            };

            // check for sticky bit
            const lastbit = info.rights && info.rights.other.slice(-1);
            if (info.rights) {
                if (lastbit === "t") {
                    info.rights.other = info.rights.other.slice(0, -1) + "x";
                    info.sticky = true;
                } else if (lastbit === "T") {
                    info.rights.other = info.rights.other.slice(0, -1);
                    info.sticky = true;
                }
            }

            if (ret.month1 !== undefined && ret.date1 !== undefined && ret.hour !== undefined && ret.minute !== undefined) {
                const month = MONTHS.get(ret.month1.toLowerCase()) as number;
                const day = parseInt(ret.date1, 10);
                const year = (new Date()).getFullYear();
                const hour = parseInt(ret.hour, 10);
                const min = parseInt(ret.minute, 10);

                let monthS = month.toString();
                let dayS = day.toString();
                let hourS = hour.toString();
                let minS = min.toString();
                if (month < 10) {
                    monthS = "0" + month;
                }
                if (day < 10) {
                    dayS = "0" + day;
                }
                if (hour < 10) {
                    hourS = "0" + hour;
                }
                if (min < 10) {
                    minS = "0" + min;
                }
                info.date = new Date(year + "-" + monthS + "-" + dayS + "T" + hourS + ":" + minS);
                // If the date is in the past but no more than 6 months old, year
                // isn't displayed and doesn't have to be the current year.
                //
                // If the date is in the future (less than an hour from now), year
                // isn't displayed and doesn't have to be the current year.
                // That second case is much more rare than the first and less annoying.
                // It's impossible to fix without knowing about the server's timezone,
                // so we just don't do anything about it.
                //
                // If we're here with a time that is more than 28 hours into the
                // future (1 hour + maximum timezone offset which is 27 hours),
                // there is a problem -- we should be in the second conditional block
                if (info.date.getTime() - Date.now() > 100800000) {
                    info.date = new Date((year - 1) + "-" + month + "-" + day + "T" + hour + ":" + min);
                }

                // If we're here with a time that is more than 6 months old, there's
                // a problem as well.
                // Maybe local & remote servers aren't on the same timezone (with remote
                // ahead of local)
                // For instance, remote is in 2014 while local is still in 2013. In
                // this case, a date like 01/01/13 02:23 could be detected instead of
                // 01/01/14 02:23
                // Our trigger point will be 3600*24*31*6 (since we already use 31
                // as an upper bound, no need to add the 27 hours timezone offset)
                if (Date.now() - info.date.getTime() > 16070400000) {
                    info.date = new Date((year + 1) + "-" + month + "-" + day + "T" + hour + ":" + min);
                }
            } else if (ret.month2 !== undefined && ret.date2 !== undefined && ret.year !== undefined) {
                const month = MONTHS.get(ret.month2.toLowerCase()) as number;
                const day = parseInt(ret.date2, 10);
                const year = parseInt(ret.year, 10);
                let monthS = month.toString();
                let dayS = day.toString();
                if (month < 10) {
                    monthS = "0" + month;
                }
                if (day < 10) {
                    dayS = "0" + day;
                }
                info.date = new Date(year + "-" + monthS + "-" + dayS + "T00:00");
            }
            return info;
        // tslint:disable-next-line:no-conditional-assignment
        } else if ((ret = regListMsDos(line))) {
            const month = parseInt(ret.month, 10);
            const day = parseInt(ret.date, 10);
            let year = parseInt(ret.year, 10);
            let hour = parseInt(ret.hour, 10);
            const mins = parseInt(ret.minute, 10);

            if (year < 70) {
                year += 2000;
            } else {
                year += 1900;
            }

            if (ret.ampm[0].toLowerCase() === "p" && hour < 12) {
                hour += 12;
            } else if (ret.ampm[0].toLowerCase() === "a" && hour === 12) {
                hour = 0;
            }

            const info: IListingElement = {
                date: new Date(year, month - 1, day, hour, mins),
                name: ret.name,
                size: (ret.isdir ? 0 : parseInt(ret.size, 10)),
                type: (ret.isdir ? "d" : "-"),
            };

            // info.date = new Date(year, month - 1, day, hour, mins);

            return info;
        } else if (!RE_ENTRY_TOTAL.test(line)) {
            return line; // could not parse, so at least give the end user a chance to
        }
        // look at the raw listing themselves
        return null;
        // throw new Error("No match found!");
    }

    private _debug?: any;
    private _buffer: string = "";

    public constructor(options: { debug: any }) {
        super();
        // WritableStream.call(this);
        this._debug = options.debug;
    }

    public _write(chunk: Buffer, encoding: string, cb: () => void) {
        const debug = this._debug;
        if (debug) {
            debug("[parser] write()");
        }
        this._buffer += chunk.toString("binary");
        let m: RegExpExecArray | null;
        if (debug) {
            debug("[parser] buffer: " + this._buffer);
        }
        // tslint:disable-next-line:no-conditional-assignment
        while ((m = RE_RES_END.exec(this._buffer))) {
            // support multiple terminating responses in the buffer
            const rest = this._buffer.substring(m.index + m[0].length);
            if (rest.length) {
                this._buffer = this._buffer.substring(0, m.index + m[0].length);
            }

            if (debug) {
                debug("[parser] < " + this._buffer);
            }

            // we have a terminating response line
            const code = parseInt(m[1], 10);

            // RFC 959 does not require each line in a multi-line response to begin
            // with '<code>-', but many servers will do this.
            //
            // remove this leading '<code>-' (or '<code> ' from last line) from each
            // line in the response ...
            let reRmLeadCode = "(^|\\r?\\n)";
            reRmLeadCode += m[1];
            reRmLeadCode += "(?: |\\-)";
            const reRmLeadCode2 = new RegExp(reRmLeadCode, "g");
            const text = this._buffer.replace(reRmLeadCode2, "$1").trim();
            this._buffer = rest;

            if (debug) {
                debug("[parser] Response: code=" + code + ", buffer=" + text);
            }
            this.emit("response", code, text);
        }

        cb();
    }
}

interface IListUnix {
    type: string;
    permission: string;
    acl: string;
    inodes: string;
    owner: string;
    group: string;
    size: string;
    month1?: string;
    date1?: string;
    hour?: string;
    minute?: string;
    month2?: string;
    date2?: string;
    year?: string;
    name: string;
}

interface IListMsDos {
    month: string;
    date: string;
    year: string;
    hour: string;
    minute: string;
    ampm: string;
    size: string;
    isdir: string;
    name: string;
}

const REX_LISTUNIX = /^([\-ld])((?:[\-r][\-w][\-xstT]){3})(\+)?\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(?:(?:(\w{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2}))|(?:(\w{3})\s+(\d{1,2})\s+(\d{4})))\s+(.+)$/;
function regListUnix(text: string): IListUnix | null {
    // "^(?<type>[\\-ld])(?<permission>([\\-r][\\-w][\\-xstT]){3})(?<acl>(\\+))?\\s+(?<inodes>\\d+)\\s+(?<owner>\\S+)\\s+(?<group>\\S+)\\s+(?<size>\\d+)\\s+(?<timestamp>((?<month1>\\w{3})\\s+(?<date1>\\d{1,2})\\s+(?<hour>\\d{1,2}):(?<minute>\\d{2}))|((?<month2>\\w{3})\\s+(?<date2>\\d{1,2})\\s+(?<year>\\d{4})))\\s+(?<name>.+)$"
    const temp = text.match(REX_LISTUNIX);
    return temp === null ? null : {
        acl: temp[3],
        date1: temp[9],
        date2: temp[13],
        group: temp[6],
        hour: temp[10],
        inodes: temp[4],
        minute: temp[11],
        month1: temp[8],
        month2: temp[12],
        name: temp[15],
        owner: temp[5],
        permission: temp[2],
        size: temp[7],
        type: temp[1],
        year: temp[14],
    };
}

const REX_LISTMSDOS = /^(\d{2})(?:\-|\/)(\d{2})(?:\-|\/)(\d{2,4})\s+(\d{2}):(\d{2})\s{0,1}([AaMmPp]{1,2})\s+(?:(\d+)|(<DIR>))\s+(.+)$/;
function regListMsDos(text: string): IListMsDos | null {
    // "^(?<month>\\d{2})(?:\\-|\\/)(?<date>\\d{2})(?:\\-|\\/)(?<year>\\d{2,4})\\s+(?<hour>\\d{2}):(?<minute>\\d{2})\\s{0,1}(?<ampm>[AaMmPp]{1,2})\\s+(?:(?<size>\\d+)|(?<isdir>\\<DIR\\>))\\s+(?<name>.+)$"
    const temp = text.match(REX_LISTMSDOS);
    return temp === null ? null : {
        ampm: temp[1],
        date: temp[1],
        hour: temp[1],
        isdir: temp[1],
        minute: temp[1],
        month: temp[1],
        name: temp[1],
        size: temp[1],
        year: temp[1],
    };
}
