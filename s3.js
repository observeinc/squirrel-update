'use strict';

const { S3Client, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

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
    return client.send(command).then((resp) => {
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

function serveBinaryFile(req, res, region, bucket, key) {
    const client = new S3Client({
        region: region
    });
    const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key
    });
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
                const fn = reFilecomp.exec(key)[1];
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
}

exports.listBucketPath = listBucketPath;
exports.serveBinaryFile = serveBinaryFile;
