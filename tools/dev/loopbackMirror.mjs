// Metro runs with --localhost (tools/dev/live.mjs) so the seat-test token endpoint stays off the LAN. On this PC
// `localhost` is [::1] only, so an emulator's `adb reverse tcp:1910N tcp:1910N` (adb dials 127.0.0.1) got an empty
// reply, and every emulator proof needed a hand-run forwarder (pit-wall ticket 58, replay #7346, apex #7625).
// This is that forwarder, inside live.mjs's own process: it listens on 127.0.0.1:<port> and pipes each connection
// to [::1]:<port>. Loopback only, so nothing new reaches the LAN. It never keeps the launcher alive (unref) and
// `shutMirror` ends it with its connections, so a stopped slot frees the port at once (ticket 58, steward #7694).
import dns from 'node:dns/promises';
import net from 'node:net';

/**
 * Mirror `localhost`'s port on 127.0.0.1 where `localhost` is [::1] (what Metro's --localhost binds); null where it
 * is already 127.0.0.1 (Metro listens there itself, and a mirror bound first would take its port).
 */
export async function mirrorLocalhost({port, lookup = dns.lookup}) {
  const {address} = await lookup('localhost');
  return address === '::1' ? mirrorLoopback({port}) : null;
}

/**
 * Mirror `to`:port on `from`:port. Resolves with the listening server, or null when `from` is taken
 * (Metro already listens there, as on a PC whose localhost is 127.0.0.1): nothing to mirror then.
 */
export function mirrorLoopback({port, from = '127.0.0.1', to = '::1'}) {
  return new Promise(resolve => {
    const server = net.createServer(client => {
      const upstream = net.connect({host: to, port});
      const pair = [client, upstream];
      open.get(server)?.add(pair);
      const drop = () => {
        client.destroy();
        upstream.destroy();
        open.get(server)?.delete(pair);
      };
      client.on('error', drop);
      upstream.on('error', drop);
      client.on('close', drop);
      upstream.on('close', drop);
      client.pipe(upstream);
      upstream.pipe(client);
    });
    open.set(server, new Set());
    server.once('error', err => {
      if (err.code !== 'EADDRINUSE' && err.code !== 'EADDRNOTAVAIL') throw err;
      resolve(null);
    });
    server.listen({port, host: from}, () => {
      // A listening socket alone must not keep the launcher alive once Metro is gone.
      server.unref();
      resolve(server);
    });
  });
}

// The connections each mirror is piping, so shutting it down can end them.
const open = new WeakMap();

/** Stop a mirror and every connection it is piping, so its port is free when this returns. Safe on null. */
export function shutMirror(server) {
  if (!server) return;
  for (const pair of open.get(server) ?? []) for (const s of pair) s.destroy();
  server.close();
}
