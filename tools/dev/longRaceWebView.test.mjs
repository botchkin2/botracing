import {test} from 'node:test';
import assert from 'node:assert/strict';

import {centreOf, devtoolsSocket, isFieldRequest, pageTarget} from './longRaceWebView.mjs';

test('the WebView socket name comes out of /proc/net/unix', () => {
  const text = [
    '0000000000000000: 00000002 00000000 00010000 0001 01 25753 @chrome_devtools_remote',
    '0000000000000000: 00000002 00000000 00010000 0001 01 51379 @webview_devtools_remote_5601',
  ].join('\n');
  assert.equal(devtoolsSocket(text, '5601'), 'webview_devtools_remote_5601');
  // another process's WebView socket is not the app's
  assert.equal(devtoolsSocket(text, '1490'), null);
  assert.equal(devtoolsSocket('nothing here', '5601'), null);
});

test('the 3D page is the embed=3d one, else the first page', () => {
  const list = [
    {type: 'service_worker', url: 'x'},
    {type: 'page', url: 'about:blank'},
    {type: 'page', url: 'http://localhost:19106/session/ab/race?embed=3d#ct=x'},
  ];
  assert.equal(pageTarget(list), list[2]);
  assert.equal(pageTarget(list.slice(0, 2)), list[1]);
  assert.equal(pageTarget([]), null);
});

test('only the race\'s own field GET is answered', () => {
  const url = 'https://botracing-61.web.app/api/sessions/0acca4e26bd7655f/field/d7bc1b633d4a';
  assert.equal(isFieldRequest({method: 'GET', url}, '0acca4e26bd7655f'), true);
  assert.equal(isFieldRequest({method: 'OPTIONS', url}, '0acca4e26bd7655f'), false);
  assert.equal(isFieldRequest({method: 'GET', url}, 'ffffffffffffffff'), false);
  assert.equal(isFieldRequest({method: 'GET', url: 'https://botracing-61.web.app/api/sessions/0acca4e26bd7655f/laps/abc'}, '0acca4e26bd7655f'), false);
});

test('a node\'s centre is read from its bounds', () => {
  const xml = '<hierarchy><node index="0" text="Track" bounds="[56,500][160,560]"/><node index="1" text="3D" resource-id="" bounds="[400,540][500,600]"/></hierarchy>';
  assert.deepEqual(centreOf(xml, '3D'), {x: 450, y: 570});
  assert.equal(centreOf(xml, 'Follow'), null);
});
