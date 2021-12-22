'use strict';

// Downloads live in s3bucket/s3path, and the file names are parsed
// to generate available versions.
const semver = require('semver');
const fs = require('fs');
const path = require('path');
const s3 = require(path.resolve(__dirname, 's3.js'));
const config = require(path.resolve(__dirname, '..', 'config.json'));

const versions = {};

//  Dispatch the given URL, returning a promise that resolves when the request
//  is done.
function dispatchUrl(url, res) {
    if (url === '/') {
        return serveFile("index.html", res);
    }
    url = /[^?]*/.exec(url)[0];
    const pieces = url.split(/\//);
    pieces.shift();
    const updateRequest = parseUpdateRequest(pieces);
    if (updateRequest) {
        return serveUpdateRequest(updateRequest, res);
    }
    const downloadRequest = parseDownloadRequest(pieces);
    if (downloadRequest) {
        return serveDownloadRequest(downloadRequest, res);
    }
    return notFound(res);
}

//  Serve a literal file.
//  returns a promise that resolves once the file has been served.
//  reject (by throwing) if the file is not found.
function serveFile(name, res) {
    return new Promise((resolve, reject) => {
        if (!name || name.match(/\.\./)) {
            reject(`invalid file name: ${name}`);
            return;
        }
        const data = fs.readFileSync(path.resolve(__dirname, '..', 'data', name), {encoding: 'utf8', flag: 'r'});
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data);
        resolve();
    });
}

//  Serve a 404, then resolve.
function notFound(res) {
    return new Promise((resolve, reject) => {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: false,
            error: "Not Found"
        }));
        resolve();
    });
};

//  synchronous parser, return non-falsey if it's an update request
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

//  Given a non-falsey update request from parseUpdateRequest, figure
//  out what to do about it, and do it; resolve when done.
function serveUpdateRequest(ur, res) {
    const osver = ur && versions[ur.os];
    const osarch = osver && osver[ur.arch];
    if (!osarch || !osarch.length) {
        return notFound(res);
    }
    if (ur.aux === 'RELEASES') {
        return s3.serveBinaryFile(res, config.s3region, config.s3bucket, osarch[0].RELEASES)
            .then(() => {
                console.log(new Date(), `done serving ${osarch[0].os}/${osarch[0].arch}/${osarch[0].version}/RELEASES`);
            });
    }
    if (!semver.gt(osarch[0].version, ur.curVersion)) {
        return new Promise((resolve, reject) => {
            res.writeHead(204, { 'Content-Type': 'application/octet-stream' });
            res.end();
            resolve();
        });
    }
    console.log(new Date(), `serving update version ${osarch[0].version} to ${ur.os}/${ur.arch}`);
    return s3.serveBinaryFile(res, config.s3region, config.s3bucket, osarch[0].updatePath)
        .then(() => {
            console.log(new Date(), `done update version ${osarch[0].version} to ${ur.os}/${ur.arch}`);
        });
}

//  sync function; parse pieces and return non-falsey if it's a download request
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

function serveDownloadRequest(dr, res) {
    const osver = dr && versions[dr.os];
    const osarch = osver && osver[dr.arch];
    if (!osarch || !osarch.length) {
        console.log(new Date(), `osarch missing: ${dr.os}/${dr.arch}/${dr.version}`);
        return notFound(res);
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
            return notFound(res);
        }
    }
    console.log(new Date(), `serving download version ${served.version} to ${dr.os}/${dr.arch}`);
    return s3.serveBinaryFile(res, config.s3region, config.s3bucket, served.downloadPath);
}

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

function sortVersion(a, b) {
    if (semver.gt(a, b)) {
        return -1;
    }
    if (semver.lt(a, b)) {
        return 1;
    }
    return 0;
}

//  os, arch, version, filename
const reReleases = /release\/([^\/]*)\/([^\/]*)\/([^\/]*)\/(RELEASES)/;
const reUpdate = /release\/([^\/]*)\/([^\/]*)\/([^\/]*)\/(.*\.nupkg)/;
const reDownload = /release\/([^\/]*)\/([^\/]*)\/([^\/]*)\/(.*\.exe)/;
const reUpdateDarwin = /release\/([^\/]*)\/([^\/]*)\/([^\/]*)\/(.*\.zip)/;
const reDownloadDarwin = /release\/([^\/]*)\/([^\/]*)\/([^\/]*)\/(.*\.dmg)/;

//  Given file names in S3, figure out what they mean.
//  The convention is that the files live in the bucket under
//  a key named releases/(os)/(arch)/(version)
function loadBucketVersions() {
    return s3.listBucketPath(config.s3bucket, config.s3path, config.s3region)
        .then((f) => {
            //  re-initialize versions
            const osver = {};
            f.forEach((fn) => {
                console.log(new Date(), 'file', fn);
                //  pick apart the filename
                const isReleasesWin32 = reReleases.exec(fn);
                const isUpdateWin32 = reUpdate.exec(fn);
                const isDownloadWin32 = reDownload.exec(fn);
                const isUpdateDarwin = reUpdateDarwin.exec(fn);
                const isDownloadDarwin = reDownloadDarwin.exec(fn);
                if (isReleasesWin32) {
                    setFile(osver, isReleasesWin32, 'RELEASES', fn);
                } else if (isUpdateWin32) {
                    setFile(osver, isUpdateWin32, 'updatePath', fn);
                } else if (isDownloadWin32) {
                    setFile(osver, isDownloadWin32, 'downloadPath', fn);
                } else if (isUpdateDarwin) {
                    setFile(osver, isUpdateDarwin, 'updatePath', fn);
                } else if (isDownloadDarwin) {
                    setFile(osver, isDownloadDarwin, 'downloadPath', fn);
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
        });
}



//  Adapt whatever data you may have into something that
//  these handlers think are a request.
class AdapterRequest {
    constructor(url) {
        this.url = url;
    }
}

//  Pass response to these handlers, and you can then pull
//  out the status code, headers, and data that they generate.
class AdapterResponse {
    constructor() {
        this.code = 500;
        this.headers = {};
        this.data = [];
    }
    writeHead(code, hdrs) {
        this.code = code;
        for (const [key, value] of Object.entries(hdrs)) {
            this.headers[key] = value;
        }
    }
    write(data) {
        if (data) {
            if (typeof(data) === 'object') {
                data = JSON.stringify(data);
            }
            this.data.push(data);
        }
    }
    end(data) {
        this.write(data);
    }
}

exports.loadBucketVersions = loadBucketVersions;
exports.dispatchUrl = dispatchUrl;
exports.notFound = notFound;
exports.serveFile = serveFile;
exports.AdapterRequest = AdapterRequest;
exports.AdapterResponse = AdapterResponse;
