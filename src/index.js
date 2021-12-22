'use strict';

/*
 * This is the main file for node.js serving the updates.
 * Start it with simply:
 *
 *     node src/index.js
 *
 * An alternative is to run it as an AWS lambda, in which case
 * the main module is lambda.js
 */

const http = require('http');
const url = require('url');
const path = require('path');
const handler = require(path.resolve(__dirname, 'handler.js'));
const config = require(path.resolve(__dirname, '..', 'config.json'));



let reqid = 0;

const S = http.createServer((req, res) => {
    reqid += 1;
    console.log(new Date(), reqid, req.method, req.url, req.headers['x-forwarded-for']);
    res.on('close', () => {
        console.log(new Date(), reqid, 'done');
    });
    handler.dispatchUrl(req.url, res)
        .then(() => {})
        .catch((err) => {
            console.error(new Date(), reqid, `error: ${err}`);
        });

});

S.on('clientError', (err, socket) => {
    if (err.code === 'ECONNRESET' || !socket.writable) {
        //  nothing to do
        return;
    }
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});


handler.loadBucketVersions()
    .then(() => {
        //  re-load new versions once an hour
        setInterval(() => {
            handler.loadBucketVersions()
                .then(()=>{})
                .catch((err) => {
                    console.error(`error reloading bucket releases: ${err}`);
                })
        }, 3600000);
        console.log(`listening on port ${config.port}`);
        S.listen(config.port);
    });


