import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function runScript(script, request, response, argument) {
    let finish;
    const finished = new Promise(resolve => {
        finish = resolve;
    });

    globalThis.$request = request;
    if (response === undefined) {
        delete globalThis.$response;
    } else {
        globalThis.$response = response;
    }
    globalThis.$argument = JSON.stringify(argument);
    globalThis.$done = finish;
    globalThis.$persistentStore = { read: () => null, write: () => true };
    globalThis.$notification = { post: () => {} };

    try {
        await import(`${new URL(script, import.meta.url)}?test=${randomUUID()}`);
        return await finished;
    } finally {
        for (const name of ['$request', '$response', '$argument', '$done', '$persistentStore', '$notification']) {
            delete globalThis[name];
        }
    }
}

test('removes only the trending section from the search square response', async () => {
    const original = {
        code: 0,
        data: [
            { type: 'history', title: 'search history' },
            { type: 'trending', title: 'hot searches' },
            { type: 'recommend', title: 'recommended searches' },
        ],
    };
    const result = await runScript(
        '../dist/bilibili.json.js',
        {
            method: 'GET',
            url: 'https://app.bilibili.com/x/v2/search/square?build=8000000',
            headers: {},
        },
        { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(original) },
        {}
    );
    const body = JSON.parse(result.body);

    assert.deepEqual(body.data, [
        { type: 'history', title: 'search history' },
        { type: 'recommend', title: 'recommended searches' },
    ]);
});

test('returns a minimal valid gRPC response for DefaultWords', async () => {
    for (const hostname of ['grpc.biliapi.net', 'app.biliapi.net', 'app.bilibili.com', 'app.biliapi.com']) {
        const result = await runScript(
            '../dist/bilibili.protobuf.request.js',
            {
                method: 'POST',
                url: `https://${hostname}/bilibili.app.interface.v1.Search/DefaultWords`,
                headers: {},
                body: new Uint8Array(),
            },
            undefined,
            {}
        );

        assert.equal(result.response.status, 200);
        assert.equal(result.response.headers['content-type'], 'application/grpc');
        assert.equal(result.response.headers['content-length'], '5');
        assert.deepEqual([...result.response.bodyBytes], [0, 0, 0, 0, 0]);
    }
});

test('wires both search toggles to executable rules for Surge and Loon', async () => {
    const [surge, loon] = await Promise.all([
        readFile(new URL('../release/surge/module/bilibili.sgmodule', import.meta.url), 'utf8'),
        readFile(new URL('../release/loon/plugin/bilibili.lpx', import.meta.url), 'utf8'),
    ]);
    const hosts = String.raw`(?:grpc\.biliapi\.net|app\.biliapi\.net|app\.bilibili\.com|app\.biliapi\.com)`;

    assert.match(surge, /\{\{\{\[搜索\]隐藏热搜\}\}\} = type=http-response,[^\r\n]+search\\\/square/);
    assert.match(surge, /\{\{\{\[搜索\]隐藏搜索发现\}\}\} = type=http-request,[^\r\n]+DefaultWords/);
    assert.match(loon, /http-response [^\r\n]+search\\\/square[^\r\n]+enable=\{hideHotSearch\}/);
    assert.match(loon, /http-request [^\r\n]+DefaultWords[^\r\n]+enable=\{hideSearchDiscover\}/);
    assert.match(surge, new RegExp(hosts));
    assert.match(loon, new RegExp(hosts));
});
