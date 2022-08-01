# Changelog for ftp-ts

<a id="1.1.0"></a>

## 2022-07-29, Version 1.1.0

### Notable Changes

#### Support for MLSx

The old `LIST` command was created for manual human reading and as such no data format is defined in the spec, which means there is quite a few variations out there.
[RFC3659](https://datatracker.ietf.org/doc/html/rfc3659#section-7) introduced two optional commands `MLSD`/`MLST` to have an extendable semantic format that is readable by software.
Usage of these commands is now preferred if supported by the FTP server.

#### Support for IPv6

[RFC3659](https://datatracker.ietf.org/doc/html/rfc3659) introduced two optional commands `EPSV` and `EPRT` to support IPv6 and onwards.
By adding support detection and heuristics these are now available for the client to use.


#### More control over PORT/EPRT

Added `FTP.localPort(bindIp, portRange)` which may be overridden for even better control over port selection and choice of network interfaces.
