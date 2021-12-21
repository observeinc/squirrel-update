'use strict';

const handler = require('./handler.js');

async function lambdafn(ev, ctx) {
    //  pick out the URL from the event
    const url = ev.path;
    //  create a fake request/response
    const res = new handler.AdapterResponse();
    res.headers['Access-Control-Allow-Origin'] = '*';
    //  dispatch to handler
    if (url != '/') {
        await handler.loadBucketVersions();
    }
    await handler.dispatchUrl(url, res);
    return {
        isBase64Encoded: false,
        statusCode: res.code,
        headers: res.headers,
        body: res.body.join('')
    };
}

exports.handler = lambdafn;
