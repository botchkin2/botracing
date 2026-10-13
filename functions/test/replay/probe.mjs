// Probe: a heartbeat and a signed upload through the Hosting emulator.
const api = process.env.REPLAY_API + '/api/upload';
const auth = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const res = await fetch(`http://${auth}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({email: 'r@example.com', password: 'secret12', returnSecureToken: true})});
const {idToken} = await res.json();
const h = {authorization: `Bearer ${idToken}`, 'content-type': 'application/json'};
const me = await fetch(`${api}/me`, {headers: h});
console.log('me', me.status, await me.text());
const up = await fetch(`${api}/file/upload-url`, {method: 'POST', headers: h, body: JSON.stringify({dest: 'archive/lmu/x/a.json', contentType: 'application/json', gzip: false, size: 2})});
const body = await up.text();
console.log('upload-url', up.status, body.slice(0, 400));
if (up.ok) {
  const {url, headers} = JSON.parse(body);
  const put = await fetch(url, {method: 'PUT', headers, body: '{}'});
  console.log('put', put.status, (await put.text()).slice(0, 300));
}
