'use strict';

const semver = require('semver');
const http = require('http');
const url = require('url');
const fs = require('fs');
const s3 = require('./s3.js');

// Downloads live in s3bucket/s3path, and the file names are parsed
// to generate available versions.
const config = require('./config.json');


function notFound(req, res) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        success: false,
        error: "Not Found",
        url: req.url
    }));
};

const fileCache = {};

const versions = {};

//  serveFile throws if the file doesn't exist.
//  This lets me be static out-of-RAM server once started.
function serveFile(name) {
    const data = fs.readFileSync(name, {encoding: 'utf8', flag: 'r'});
    return (req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data);
        return;
    };
}

const serveIndex = serveFile('index.html');

function parseUpdateRequest(pieces) {
    if (pieces && pieces.length >= 4 && pieces[0] === 'update') {
        let aux = undefined;
        if (pieces.length >= 5) {
            aux = pieces[4];
        }
        return {
            os: pieces[1],
            arch: pieces[2],
            curVersion: semver.coerce(pieces[3]),
            aux: aux
        };
    }
    return null;
}

function serveUpdateRequest(ur, req, res) {
    console.log('serveUpdateRequest', ur);
    const osver = ur && versions[ur.os];
    const osarch = osver && osver[ur.arch];
    if (!osarch || !osarch.length) {
        notFound(req, res);
        return;
    }
    if (ur.aux === 'RELEASES') {
        s3.serveBinaryFile(req, res, config.s3region, config.s3bucket, osarch[0].RELEASES)
            .then(() => {
                console.log(new Date(), `done serving ${osarch[0].os}/${osarch[0].arch}/${osarch[0].version}/RELEASES to ${req.headers['x-forwarded-for']}`);
            })
            .catch((err) => {
                console.error(new Date(), err);
            });
        return;
    }
    console.log(`cur`, osarch[0]);
    if (!semver.gt(osarch[0].version, ur.curVersion)) {
        res.writeHead(204, { 'Content-Type': 'application/octet-stream' });
        res.end();
        return;
    }
    console.log(new Date(), `serving update version ${osarch[0].version} to ${ur.os}/${ur.arch} at ${req.headers['x-forwarded-for']}`);
    s3.serveBinaryFile(req, res, config.s3region, config.s3bucket, osarch[0].updatePath)
        .then(() => {
            console.log(new Date(), `done update version ${osarch[0].version} to ${ur.os}/${ur.arch} at ${req.headers['x-forwarded-for']}`);
        })
        .catch((err) => {
            console.error(new Date(), err);
        });
}

function parseDownloadRequest(pieces) {
    if (pieces && pieces.length >= 4 && pieces[0] === 'download') {
        let aux = undefined;
        return {
            os: pieces[1],
            arch: pieces[2],
            version: pieces[3]
        };
    }
    return null;
}

function serveDownloadRequest(dr, req, res) {
    console.log('serveDownloadRequest', dr);
    const osver = dr && versions[dr.os];
    const osarch = osver && osver[dr.arch];
    if (!osarch || !osarch.length) {
        console.log(new Date(), `osarch missing: ${dr.os}/${dr.arch}/${dr.version}`);
        notFound(req, res);
        return;
    }
    let served = osarch[0];
    if (dr.version !== 'latest') {
        //  find the specific version
        dr.version = semver.coerce(dr.version);
        served = null;
        osarch.forEach((ver) => {
            if (ver.version == dr.version) {
                served = ver;
            }
        });
        if (!served) {
            console.log(new Date(), `version missing: ${dr.os}/${dr.arch}/${dr.version}`, versions);
            notFound(req, res);
            return;
        }
    }
    console.log(new Date(), `serving download version ${served.version} to ${dr.os}/${dr.arch} at ${req.headers['x-forwarded-for']}`);
    s3.serveBinaryFile(req, res, config.s3region, config.s3bucket, served.downloadPath)
        .catch((err) => {
            console.error(new Date(), err);
        });
}

//  os, arch
const reReleases = /release\/([^\/]*)\/([^\/]*)\/([^\/]*)\/RELEASES/;
const reUpdate = /release\/([^\/]*)\/([^\/]*)\/([^\/]*)\/(.*\.nupkg)/;
const reDownload = /release\/([^\/]*)\/([^\/]*)\/([^\/]*)\/(.*\.exe)/;

function setFile(osver, pieces, key, fn) {
    let o = osver[pieces[1]];
    if (!o) {
        o = {};
        osver[pieces[1]] = o;
    }
    let a = o[pieces[2]];
    if (!a) {
        a = {};
        o[pieces[2]] = a;
    }
    let v = a[pieces[3]];
    if (!v) {
        v = {
            os: pieces[1],
            arch: pieces[2],
            version: pieces[3]
        };
        a[pieces[3]] = v;
    }
    v[key] = fn;
}

//  Given file names in S3, figure out what they mean.
//  The convention is that the files live in the bucket under
//  a key named releases/(os)/(arch)/(version)
function loadBucketVersions() {
    s3.listBucketPath(config.s3bucket, config.s3path, config.s3region).then((f) => {
        //  re-initialize versions
        const osver = {};
        f.forEach((fn) => {
            console.log(new Date(), 'file', fn);
            //  pick apart the filename
            const isReleasesWin32 = reReleases.exec(fn);
            const isUpdateWin32 = reUpdate.exec(fn);
            const isDownloadWin32 = reDownload.exec(fn);
            if (isReleasesWin32) {
                setFile(osver, isReleasesWin32, 'RELEASES', fn);
            } else if (isUpdateWin32) {
                setFile(osver, isUpdateWin32, 'updatePath', fn);
            } else if (isDownloadWin32) {
                setFile(osver, isDownloadWin32, 'downloadPath', fn);
            } else {
                console.log(new Date(), `Don't know what to do with ${fn}`);
            }
        });
        versions.darwin = { x64: [], arm64: [] };
        versions.win32 = { x64: [] };
        versions.linux = { x64: [] };
        for (const [os, osarch] of Object.entries(osver)) {
            for (const [arch, osarchver] of Object.entries(osarch)) {
                for (const [ver, item] of Object.entries(osarchver)) {
                    if (!versions[os] || !versions[os][arch]) {
                        console.log(`missing OS/Arch: ${os}/${arch}`, versions);
                    }
                    versions[os][arch].push(item);
                }
            }
        }
        //  sort with latest version first
        versions.darwin.x64.sort(sortVersion);
        versions.darwin.arm64.sort(sortVersion);
        versions.win32.x64.sort(sortVersion);
        versions.linux.x64.sort(sortVersion);
        console.log(new Date(), `loaded ${f.length} versions`);
    }).catch((err) => {
        console.error(new Date(), `error listing versions: ${err}`);
        throw err;
    });
}

function sortVersion(a, b) {
    if (semver.gt(a, b)) {
        return -1;
    }
    if (semver.lt(a, b)) {
        return 1;
    }
    return 0;
}

let reqid = 0;

const S = http.createServer((req, res) => {
    reqid += 1;
    console.log(new Date(), reqid, req.method, req.url, req.headers['x-forwarded-for']);
    res.on('close', () => {
        console.log(new Date(), reqid, 'done');
    });
    if (!versions) {
        notFound(req, res);
        return;
    }
    if (req.url === '/') {
        serveIndex(req, res);
        return;
    }
    const pieces = req.url.split(/\//);
    pieces.shift();
    const updateRequest = parseUpdateRequest(pieces);
    if (updateRequest) {
        serveUpdateRequest(updateRequest, req, res);
        return;
    }
    const downloadRequest = parseDownloadRequest(pieces);
    if (downloadRequest) {
        serveDownloadRequest(downloadRequest, req, res);
        return;
    }
    notFound(req, res);
});

S.on('clientError', (err, socket) => {
    if (err.code === 'ECONNRESET' || !socket.writable) {
        //  nothing to do
        return;
    }
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

S.listen(config.port);

loadBucketVersions();

//  re-load new versions once an hour
setInterval(loadBucketVersions, 3600000);
