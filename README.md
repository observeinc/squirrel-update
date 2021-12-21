squirrel-update
---------------

This is a simple service (written in Node) that proxies release
binaries from a configured S3 bucket to the update API requests
from an Electron app (using the squirrel updaters.)

This is helpful when your binary is larger than the 100 MB
limit that Git releases impose on top of the default update
services (and the free update service.)

You will of course have to arrange to run this service behind
some HTTP termination, and pay for the bandwidth used by the S3
bucket, so generally, this is best used for internal tools, or
fully funded projects.
