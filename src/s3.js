'use strict';

const { S3Client, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

//  For now, up to 1000 release binaries are supported.
//  Once we have more than that many versions, we will have
//  to paginate with "StartAfter" in multiple requests.
function listBucketPath(bucket, path, region) {
    const client = new S3Client({
        region: region
    });
    const command = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: path + '/'
    });
    return client.send(command)
        .then((resp) => {
            const ret = [];
            if (resp.Contents) {
                resp.Contents.forEach((el) => {
                    ret.push(el.Key);
                });
            }
            return ret;
        });
}

const reFilecomp = /\/([^\/"\\:]*)$/;
const reZip = /\.zip$/;

function contentTypeFromKey(key) {
    if (key.match(reZip)) {
        return 'application/zip';
    }
    return 'application/octet-stream';
}

function serveBinaryFile(res, region, bucket, key, flavor) {
    console.log('serveBinaryFile', region, bucket, key);
    const fn = reFilecomp.exec(key)[1];
    const client = new S3Client({
        region: region
    });
    const contentType = contentTypeFromKey(key);
    const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${fn}"`,
        ResponseContentType: contentType
    });
    return getSignedUrl(client, command, { expiresIn: 3600*4 })
        .then((url) => {
            console.log(new Date(), `redirect to ${flavor} of ${contentType} at ${url}`);
            if (flavor !== undefined && flavor === 'darwin') {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.write(JSON.stringify({
                    "url": url,
                    "name": key
                }));
            } else {
                //  temporary redirect, always use GET
                res.writeHead(303, {
                    'Location': url
                });
            }
            res.end();
        })
        .catch((err) => {
            const text = `Could not pre-sign URL: ${err}`;
            console.error(new Date(), text);
            res.writeHead(500, {
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({
                success: true,
                error: text
            }));
        });

    /*
     * To stream out all the data as a proxy, uncomment this code.
     * This works as a node service, but not as a lambda.
     *

    return client.send(command).then((resp) => {
        //  resp.Body is the data
        if (!resp.Body) {
            console.error(new Date(), `no body for ${region}/${bucket}/${key}`);
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                error: `Could not find ${key}.`
            }));
        } else {
            return new Promise((resolve, reject) => {
                res.writeHead(200, {
                    'Content-Type': 'application/octet-stream',
                    'Content-Disposition': `attachment; filename="${fn}"`
                });
                resp.Body.pipe(res);
            });
        }
    }).catch((err) => {
        console.error(new Date(), `error serving ${region}/${bucket}/${key}: ${err}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: false,
            error: `${err}`
        }));
    });

     *
     */
}


exports.listBucketPath = listBucketPath;
exports.serveBinaryFile = serveBinaryFile;
