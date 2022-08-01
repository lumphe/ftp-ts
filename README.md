# FTP-ts

FTP-ts is an FTP client module for [node.js](http://nodejs.org/) that provides an asynchronous interface for communicating with a FTP server.

It is a rewritten version of the [ftp package](https://github.com/mscdex/node-ftp/) from `mscdex`.


## Requirements

[node.js](http://nodejs.org/) -- v8.0 or newer

Note: For node version &lt; 10, one of the `--harmony_async_iteration` or `--harmony` flags must be used.

## Install

    npm install ftp-ts

## Examples

### Get a directory listing of the current (remote) working directory

```javascript
  import Client from "ftp-ts";

  // connect to localhost:21 as anonymous
  Client.connect({host: "127.0.0.1", port: 21}).then(async (c) => {
    console.dir(await c.list());
    c.end();
  });
```

### Download remote file 'foo.txt' and save it to the local file system

```javascript
  import Client from "ftp-ts";
  import { createWriteStream } from "fs";

  // connect to localhost:21 as anonymous
  Client.connect({host: "127.0.0.1", port: 21}).then(async (c) => {
    const stream = await c.get('foo.txt');
    stream.pipe(createWriteStream('foo.local-copy.txt'));
    c.end();
  });
```

### Upload local file 'foo.txt' to the server

```javascript
  import Client from "ftp-ts";

  // connect to localhost:21 as anonymous
  Client.connect({host: "127.0.0.1", port: 21}).then((c) => {
    c.put('foo.txt', 'foo.remote-copy.txt');
    c.end();
  })
```

### Fallback to using PORT for data connections

```javascript
  import Client from "ftp-ts";

  // connect to localhost:21 as anonymous
  // Config PORT address and PORT range
  Client.connect({host: "127.0.0.1", port: 2111, portAddress: "127.0.0.1", portRange: "6000-7000"}).then(async (c) => {
    console.dir(await c.list());
    c.end();
  });
```

## Implementation

List of implemented required "standard" commands (RFC 959):
* [list](#ftplistpath-usecompression)
* [get](#ftpgetpath-usecompression)
* [put](#ftpputinput-destpath-usecompression)
* [append](#ftpappendinput-destpath-usecompression)
* [rename](#ftprenameoldpath-newpath)
* [logout](#ftplogout)
* [delete](#ftpdeletepath)
* [cwd](#ftpcwdpath-promote)
* [abort](#ftpabortimmediate)
* [site](#ftpsitecommand)
* [status](#ftpstatus)
* [ascii](#ftpascii)
* [binary](#ftpbinary)

List of implemented optional "standard" commands (RFC 959):
* [mkdir](#ftpmkdirpath-recursive)
* [rmdir](#ftprmdirpath-recursive)
* [cdup](#ftpcdup)
* [pwd](#ftppwd)
* [system](#ftpsystem)
* [listSafe](#ftplistSafepath-usecompression)

List of implemented extended commands (RFC 3659)
* [size](#ftpsizepath)
* [lastMod](#ftplastmodpath)
* [restart](#ftprestartbyteoffset)

## Class: FTP, default

### new FTP()

Creates a new FTP client.

### Class Method: FTP.connect([options])

* `options` [&lt;Object&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object) See [ftp.connect](#ftpconnectoptions) for which options are available.
* Returns:         [&lt;Promise&lt;FTP&gt;&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) The promise is resolved to a [FTP](#class-ftp-default).

### Event: 'greeting'

* [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) the text the server sent upon connection.

Emitted after connection.

### Event: 'ready'

Emitted when connection and authentication were sucessful.

### Event: 'close'

* [&lt;boolean&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Boolean_type) if closed becouse of error

Emitted when the connection has fully closed.

### Event: 'end'

Emitted when the connection has ended.

### Event: 'error'

* [&lt;Error&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error) the error when an error occurs

Emitted when an error occurs. In case of protocol-level errors, the error contains a `code` property that references the related 3-digit FTP response code.

### Override: ftp.localPort(bindIp[, portRange])

* `bindIp`         [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) The IP to bind the `PORT` socket to.
* `portRange`      [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) The range of ports to use when setting up `PORT` sockets.
* Returns:         [&lt;Promise&lt;[string, string | number]&gt;&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) The promise is resolved to the following object.
    * 0            [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) The `bindIp` to actually bind to.
    * 1            [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) The `portRange` or `portNumber` to bind to.

This method may be overridden on the instance to allow for better managed `PORT`/`EPRT` commands.

For example, you may wish to bind only to a specific network interface for security reasons.
In that case you may override this method to return the `bindIp` with a value of `127.0.0.1` instead of `0.0.0.0` to only allow incoming connections from localhost.

Another reason may be to decide upon a port number and `await` some NAT rules to propagate before the remote server connects.

This could also be useful if your external IP family does not match the family of your interface due to proxying or NAT rules.
By default the zero `bindIp` will always be in the same IP family as the external IP set as `portAddress` in the `IOption` object.


### ftp.connect([options])

* `options` [&lt;Object&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)
    * `host`         [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) The hostname or IP address of the FTP server. **Default:** `'localhost'`.
    * `port`         [&lt;number&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Number_type) The port of the FTP server. **Default:** `21`.
    * `portAddress`  [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) The external IP address for the server to connect to when using `PORT`.
    * `portRange`    [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) The range of ports to use when setting up `PORT` sockets.
    * `secure`       [&lt;boolean&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Boolean_type) | [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) Set to `true` for both control and data connection encryption, `'control'` for control connection encryption only, or `'implicit'` for implicitly encrypted control connection (this mode is deprecated in modern times, but usually uses port 990) **Default:** `false`.
    * `secureOptions` [&lt;Object&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object) Additional options to be passed to [`tls.connect()`](https://nodejs.org/api/tls.html#tls_tls_connect_options_callback).
    * `user`         [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) Username for authentication. **Default:** `'anonymous'`.
    * `password`     [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) Password for authentication. **Default:** `'anonymous@'`.
    * `connTimeout`  [&lt;number&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Number_type) How long (in milliseconds) to wait for the control connection to be established. **Default:** `10000`.
    * `dataTimeout`  [&lt;number&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Number_type) How long (in milliseconds) to wait for a `PASV`/`PORT` data connection to be established. **Default:** `10000`.
    * `keepalive`    [&lt;number&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Number_type) How often (in milliseconds) to send a 'dummy' (NOOP) command to keep the connection alive. **Default:** `10000`.

Connects to an FTP server.

### ftp.end()

Closes the connection to the server after any/all enqueued commands have been executed.

### ftp.destroy()

Closes the connection to the server immediately.

### ftp.list([path[, useCompression]])

* `path`           [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) **Default:** current directory.
* `useCompression` [&lt;boolean&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Boolean_type) **Default:** `false`.
* Returns:         [&lt;Promise&lt;Object&gt;&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) The promise is resolved to the following object.
    * type         [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) A single character denoting the entry type: `'d'` for directory, `'-'` for file (or `'l'` for symlink on **\*NIX only**).
    * name         [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) The name of the entry.
    * size         [&lt;number&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Number_type) The size of the entry in bytes.
    * date         [&lt;Date&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) The last modified date of the entry.
    * rights       [&lt;Object&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object) The various permissions for this entry **(*NIX only)**.
        * user     [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) An empty string or any combination of `'r'`, `'w'`, `'x'`.
        * group    [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) An empty string or any combination of `'r'`, `'w'`, `'x'`.
        * other    [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) An empty string or any combination of `'r'`, `'w'`, `'x'`.
    * owner        [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) The user name or ID that this entry belongs to **(*NIX only)**.
    * group        [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) The group name or ID that this entry belongs to **(*NIX only)**.
    * target       [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) For symlink entries, this is the symlink's target **(*NIX only)**.
    * sticky       [&lt;boolean&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Boolean_type) `true` if the sticky bit is set for this entry **(*NIX only)**.

Get a directory listing from the server.

### ftp.get(path[, useCompression])

* `path`           [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) The name of the file to retreive.
* `useCompression` [&lt;boolean&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Boolean_type) **Default:** `false`.
* Returns:         [&lt;Promise&lt;stream.Readable&gt;&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) The promise is resolved to a [stream.Readable](https://nodejs.org/api/stream.html#stream_class_stream_readable).

Retrieves a file at `path` from the server.

### ftp.put(input, destPath[, useCompression])

* `input`          [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) | [&lt;buffer&gt;](https://nodejs.org/api/buffer.html#buffer_class_buffer) | [&lt;stream.Readable&gt;](https://nodejs.org/api/stream.html#stream_class_stream_readable) The file name as a string, the file content as a buffer, the file content as a stream.
* `destPath`       [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) The name of the file to write.
* `useCompression` [&lt;boolean&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Boolean_type) **Default:** `false`.
* Returns:         [&lt;Promise&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)

Sends data to the server to be stored as `destPath`.

### ftp.append(input, destPath[, useCompression])

* `input`          [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) | [&lt;buffer&gt;](https://nodejs.org/api/buffer.html#buffer_class_buffer) | [&lt;stream.Readable&gt;](https://nodejs.org/api/stream.html#stream_class_stream_readable) The file name as a string, the file content as a buffer, the file content as a stream.
* `destPath`       [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) The name of the file to write.
* `useCompression` [&lt;boolean&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Boolean_type) **Default:** `false`.
* Returns:         [&lt;Promise&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)

Sends data to the server to be stored as `destPath`, except if `destPath` already exists, it will be appended to instead of overwritten.

### ftp.rename(oldPath, newPath)

* `oldPath`        [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) The name of the file to move.
* `newPath`        [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) The new name of the file.
* Returns:         [&lt;Promise&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)

Renames `oldPath` to `newPath` on the server.

### ftp.logout()

* Returns:         [&lt;Promise&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)

Logout the user from the server.

### ftp.delete(path)

* `path`           [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) The name of the file to delete.
* Returns:         [&lt;Promise&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)

Deletes the file represented by `path` on the server.

### ftp.cwd(path[, promote])

* `path`           [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) The path to the new working directory.
* `promote`        [&lt;boolean&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Boolean_type) **Default:** `false`.
* Returns:         [&lt;Promise&lt;string | undefined&gt;&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) The promise is resolved to a [string](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) or [undefined](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Undefined_type).

Changes the current working directory to `path`.

### ftp.abort(immediate)

* `immediate`      [&lt;boolean&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Boolean_type) **Default:** `true`.
* Returns:         [&lt;Promise&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)

Aborts the current data transfer (e.g. from get(), put(), or list()).

### ftp.site(command)

* `command`        [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) `SITE` command to send.
* Returns:         [&lt;Promise&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) The promise is resolved to a tuple of a [number](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Number_type)  and an optional [string](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) 

Sends `command` (e.g. 'CHMOD 755 foo', 'QUOTA') using SITE.

### ftp.status()

* Returns:         [&lt;Promise&lt;string&gt;&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) The promise is resolved to a [string](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type)

Retrieves human-readable information about the server's status.

### ftp.ascii()

* Returns:         [&lt;Promise&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)

Sets the transfer data type to ASCII.

### ftp.binary()

* Returns:         [&lt;Promise&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)

Sets the transfer data type to binary (default at time of connection).

### ftp.mkdir(path[, recursive])

* `path`           [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) The path to the new directory.
* `recursive`      [&lt;boolean&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Boolean_type) Is for enabling a 'mkdir -p' algorithm **Default:** `false`.
* Returns:         [&lt;Promise&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)

Creates a new directory, `path`, on the server.

### ftp.rmdir(path[, recursive])

* `path`           [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) The path of the directory to delete.
* `recursive`      [&lt;boolean&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Boolean_type) Will delete the contents of the directory if it is not empty **Default:** `false`.
* Returns:         [&lt;Promise&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)

Removes a directory, `path`, on the server.

### ftp.cdup()

* Returns:         [&lt;Promise&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)

Changes the working directory to the parent of the current directory.

### ftp.pwd()

* Returns:         [&lt;Promise&lt;string | undefined&gt;&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) The promise is resolved to a [string](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) when the server replies with a path.

Retrieves the current working directory.

### ftp.system()

* Returns:         [&lt;Promise&lt;string&gt;&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) The promise is resolved to a [string](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) when the server sends a reply.

Retrieves the server's operating system.

### ftp.listSafe([path[, useCompression]])

* `path`           [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) **Default:** current directory.
* `useCompression` [&lt;boolean&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Boolean_type) **Default:** `false`.
* Returns:         [&lt;Promise&lt;Object&gt;&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) The promise is resolved to the following object.
    * type         [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) A single character denoting the entry type: `'d'` for directory, `'-'` for file (or `'l'` for symlink on **\*NIX only**).
    * name         [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) The name of the entry.
    * size         [&lt;number&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Number_type) The size of the entry in bytes.
    * date         [&lt;Date&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) The last modified date of the entry.
    * rights       [&lt;Object&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object) The various permissions for this entry **(*NIX only)**.
        * user     [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) An empty string or any combination of `'r'`, `'w'`, `'x'`.
        * group    [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) An empty string or any combination of `'r'`, `'w'`, `'x'`.
        * other    [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) An empty string or any combination of `'r'`, `'w'`, `'x'`.
    * owner        [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) The user name or ID that this entry belongs to **(*NIX only)**.
    * group        [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) The group name or ID that this entry belongs to **(*NIX only)**.
    * target       [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) For symlink entries, this is the symlink's target **(*NIX only)**.
    * sticky       [&lt;boolean&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Boolean_type) `true` if the sticky bit is set for this entry **(*NIX only)**.

Similar to list(), except the directory is temporarily changed to `path` to retrieve the directory listing. This is useful for servers that do not handle characters like spaces and quotes in directory names well for the LIST command. This function is "optional" because it relies on pwd() being available.

### ftp.size(path)

* `path`           [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) The path of the file.
* Returns:         [&lt;Promise&lt;number&gt;&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) The promise is resolved to a [number](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Number_type) 

Retrieves the size of `path`.

### ftp.lastMod(path)

* `path`           [&lt;string&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#String_type) The path of the file.
* Returns:         [&lt;Promise&lt;date&gt;&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) The promise is resolved to a [date](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Date_type) 

Retrieves the last modified date and time for `path`.

### ftp.restart(byteOffset)

* `byteOffset`     [&lt;number&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Number_type)
* Returns:         [&lt;Promise&gt;](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)

Sets the file byte offset for the next file transfer action (get/put) to `byteOffset`.
