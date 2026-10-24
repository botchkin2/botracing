import {beforeEach, describe, expect, it} from '@jest/globals';

import {type PresetsDoc} from '@/src/data/presets';
import {
  DEFAULT_LENGTH,
  type FuelPreset,
  initialSync,
  migrateStored,
  newPreset,
  useFuelPresets,
} from '@/src/state/fuelPresets';

import {
  handleFuelPresets,
  type PresetsDoc as ServerDoc,
} from '../../../functions/src/fuelPresetsCore';

import {syncPresets, type SyncDeps} from './presetSync';

// The real server rules (functions/src/fuelPresetsCore.ts) behind an in-memory store, and the
// real store: two devices are two snapshots of it, swapped in for each step.
const NOW = Date.parse('2026-10-24T12:00:00Z');
const at = (day: number) => `2026-10-${String(day).padStart(2, '0')}T10:00:00Z`;
const make = (id: string, over: Partial<FuelPreset> = {}): FuelPreset => ({
  ...newPreset(`Rules ${id}`, {fuelL: 73}, id, at(20)),
  ...over,
});

class Server {
  doc: ServerDoc | null = null;
  down = false;
  puts = 0;
  /** Runs inside a write, before it lands: a change made while the request is out. */
  midWrite: (() => void) | null = null;
  private deps = () => ({
    owner: async () => 'botkin',
    read: async () => this.doc,
    writeIf: async (_owner: string, base: number, next: ServerDoc) => {
      const current = this.doc ?? {presets: [], removed: {}, version: 0, updatedAt: null};
      if (current.version !== base) return {ok: false as const, current};
      this.doc = next;
      return {ok: true as const};
    },
    now: () => NOW,
  });
  async get(): Promise<PresetsDoc> {
    if (this.down) throw new Error('offline');
    return (await handleFuelPresets(this.deps(), 'GET', 'x', undefined)).body as PresetsDoc;
  }
  async put(body: unknown): Promise<{ok: boolean; doc: PresetsDoc}> {
    if (this.down) throw new Error('offline');
    this.puts++;
    this.midWrite?.();
    this.midWrite = null;
    const reply = await handleFuelPresets(this.deps(), 'PUT', 'x', body);
    if (reply.status !== 200 && reply.status !== 409) throw new Error(`status ${reply.status}`);
    return {ok: reply.status === 200, doc: reply.body as PresetsDoc};
  }
}

const depsFor = (server: Server): SyncDeps => ({
  get: () => server.get(),
  put: body => server.put(body),
  local: () => useFuelPresets.getState(),
  applyServer: doc => useFuelPresets.getState().applyServer(doc, NOW),
});

const fresh = () => ({
  presets: [] as FuelPreset[],
  activeId: null as string | null,
  length: DEFAULT_LENGTH,
  ...initialSync,
});


class Device {
  snap: ReturnType<typeof fresh> = fresh();
  constructor(private server: Server) {}
  private enter() {
    useFuelPresets.setState(this.snap);
  }
  private leave() {
    const s = useFuelPresets.getState();
    this.snap = {
      presets: s.presets,
      activeId: s.activeId,
      length: s.length,
      removed: s.removed,
      version: s.version,
      pending: s.pending,
      synced: s.synced,
      owner: s.owner,
      byOwner: s.byOwner,
    };
  }
  act(fn: (store: ReturnType<typeof useFuelPresets.getState>) => void) {
    this.enter();
    fn(useFuelPresets.getState());
    this.leave();
  }
  async sync(server: Server = this.server) {
    this.enter();
    try {
      await syncPresets(depsFor(server));
    } finally {
      this.leave();
    }
  }
  get ids() {
    return this.snap.presets.map(p => p.id).sort();
  }
}

let server: Server;
let phone: Device;
let pc: Device;
beforeEach(() => {
  server = new Server();
  phone = new Device(server);
  pc = new Device(server);
});

describe('the first sync: nothing the device holds is dropped', () => {
  it('a device that only ever kept its presets locally uploads them, merged into the account by id', async () => {
    // saved before the sync existed: stored with no removed / version / pending
    const stored = migrateStored({presets: [make('old1'), make('old2')], activeId: 'old1'}, 2);
    expect(stored.pending).toBe(true);
    phone.snap = {...fresh(), presets: stored.presets, activeId: 'old1', pending: stored.pending};
    pc.act(s => s.save(make('on-pc')));
    await pc.sync();
    await phone.sync();
    expect(phone.ids).toEqual(['old1', 'old2', 'on-pc']);
    expect(server.doc?.presets.map(p => p.id).sort()).toEqual(['old1', 'old2', 'on-pc']);
    expect(phone.snap.pending).toBe(false);
    expect(phone.snap.activeId).toBe('old1');
    await pc.sync();
    expect(pc.ids).toEqual(['old1', 'old2', 'on-pc']);
  });

  it('migrating the stored list keeps every preset and resets only version 1\'s length', () => {
    const list = [make('a'), make('b')];
    const v1 = migrateStored({presets: list, activeId: 'b', length: {kind: 'laps', value: 22}}, 1);
    expect(v1.presets).toEqual(list);
    expect(v1.length).toEqual(DEFAULT_LENGTH);
    const v2 = migrateStored({presets: list, activeId: 'b', length: {kind: 'laps', value: 22}}, 2);
    expect(v2.length).toEqual({kind: 'laps', value: 22});
    expect(v2).toMatchObject({removed: {}, version: 0, pending: true, owner: null});
    expect(migrateStored(undefined, 0).presets).toEqual([]);
    expect(migrateStored({presets: [], activeId: null}, 2).pending).toBe(false);
  });
});

describe('two devices', () => {
  it('a preset saved on the phone appears on the PC, and the other way round', async () => {
    phone.act(s => s.save(make('p1')));
    await phone.sync();
    pc.act(s => s.save(make('c1')));
    await pc.sync();
    await phone.sync();
    expect(pc.ids).toEqual(['c1', 'p1']);
    expect(phone.ids).toEqual(['c1', 'p1']);
    expect(phone.snap.version).toBe(server.doc?.version);
  });

  it('the active preset and the race length stay on their device', async () => {
    phone.act(s => s.save(make('p1', {length: {kind: 'laps', value: 30}})));
    await phone.sync();
    await pc.sync();
    expect(pc.snap.activeId).toBeNull();
    expect(pc.snap.length).toEqual(DEFAULT_LENGTH);
    expect(phone.snap.activeId).toBe('p1');
  });

  it('a stale write is refused, the device merges what it gets and writes again: neither side loses a save', async () => {
    await phone.sync();
    await pc.sync();
    // both hold version 0; the PC writes first
    pc.act(s => s.save(make('from-pc')));
    await pc.sync();
    phone.act(s => s.save(make('from-phone')));
    // the phone still believes the account is at its old version only through its own read, so
    // force the stale write: the server moves between the phone's read and its write
    server.midWrite = () => {
      server.doc = {
        ...(server.doc as ServerDoc),
        version: (server.doc as ServerDoc).version + 1,
        presets: [...(server.doc as ServerDoc).presets, make('third-device')],
      };
    };
    await phone.sync();
    expect(phone.ids).toEqual(['from-pc', 'from-phone', 'third-device']);
    expect(server.doc?.presets.map(p => p.id).sort()).toEqual(['from-pc', 'from-phone', 'third-device']);
    expect(phone.snap.pending).toBe(false);
  });

  it('the same id edited on both: both are kept, the newer one under the id', async () => {
    phone.act(s => s.save(make('a', {name: 'Phone', savedAt: at(22)})));
    pc.act(s => s.save(make('a', {name: 'PC', savedAt: at(21)})));
    await phone.sync();
    await pc.sync();
    await phone.sync();
    expect(pc.snap.presets).toHaveLength(2);
    expect(pc.snap.presets.find(p => p.id === 'a')?.name).toBe('Phone');
    expect(pc.snap.presets.find(p => p.id !== 'a')?.name).toBe('PC (copy)');
    expect(phone.ids).toEqual(pc.ids);
  });
});

describe('a removal sticks', () => {
  it('removed on the phone, the PC offline still holding it: it stays gone after the PC syncs', async () => {
    phone.act(s => s.save(make('a')));
    phone.act(s => s.save(make('b')));
    await phone.sync();
    await pc.sync();
    expect(pc.ids).toEqual(['a', 'b']);
    // the PC goes offline; the phone removes `a` and syncs
    phone.act(s => s.remove('a'));
    await phone.sync();
    expect(server.doc?.presets.map(p => p.id)).toEqual(['b']);
    expect(Object.keys(server.doc?.removed ?? {})).toEqual(['a']);
    // the PC comes back, never having seen the removal
    await pc.sync();
    expect(pc.ids).toEqual(['b']);
    expect(server.doc?.presets.map(p => p.id)).toEqual(['b']);
  });

  it('removing the active preset clears the active one on this device', async () => {
    phone.act(s => s.save(make('a')));
    expect(phone.snap.activeId).toBe('a');
    phone.act(s => s.remove('a'));
    expect(phone.snap.activeId).toBeNull();
    expect(phone.snap.pending).toBe(true);
  });

  it('a removal made on another device clears this one\'s active preset when it syncs', async () => {
    pc.act(s => s.save(make('a')));
    await pc.sync();
    await phone.sync();
    phone.act(s => s.select('a'));
    expect(phone.snap.activeId).toBe('a');
    pc.act(s => s.remove('a'));
    await pc.sync();
    await phone.sync();
    expect(phone.ids).toEqual([]);
    expect(phone.snap.activeId).toBeNull();
  });
});

describe('offline', () => {
  it('a save made offline stays pending, survives a failed try, and is on the account once online', async () => {
    server.down = true;
    phone.act(s => s.save(make('offline')));
    await expect(phone.sync()).rejects.toThrow('offline');
    expect(phone.snap.pending).toBe(true);
    expect(phone.ids).toEqual(['offline']);
    expect(server.doc).toBeNull();
    server.down = false;
    await phone.sync();
    expect(server.doc?.presets.map(p => p.id)).toEqual(['offline']);
    expect(phone.snap.pending).toBe(false);
  });

  it('a change made while a write is out is not overwritten and is sent in the next round', async () => {
    phone.act(s => s.save(make('first')));
    server.midWrite = () => {
      // the person saves another preset while the request is in flight
      useFuelPresets.getState().save(make('during'));
    };
    await phone.sync();
    expect(server.puts).toBe(2);
    expect(server.doc?.presets.map(p => p.id).sort()).toEqual(['during', 'first']);
    expect(phone.snap.pending).toBe(false);
  });

  it('a sync with nothing to send writes nothing', async () => {
    phone.act(s => s.save(make('a')));
    await phone.sync();
    const puts = server.puts;
    await phone.sync();
    await phone.sync();
    expect(server.puts).toBe(puts);
  });
});

describe('an edit on one device is not a conflict on the others', () => {
  const sprint = (over: Partial<FuelPreset> = {}) =>
    make('a', {name: 'Sprint', savedAt: at(20), ...over});

  it('A edits and syncs, B (which only holds the old copy) syncs: B gets the edit and no copy appears anywhere', async () => {
    phone.act(s => s.save(sprint()));
    await phone.sync();
    await pc.sync();
    phone.act(s => s.save(sprint({mandatoryStops: 1, savedAt: at(22)})));
    await phone.sync();
    await pc.sync();
    expect(pc.snap.presets).toHaveLength(1);
    expect(pc.snap.presets[0]).toMatchObject({id: 'a', mandatoryStops: 1});
    expect(pc.snap.pending).toBe(false);
    await phone.sync();
    expect(server.doc?.presets).toHaveLength(1);
    expect(phone.snap.presets).toHaveLength(1);
  });

  it('B edits while the account did not: B keeps its edit, and A gets it without a copy', async () => {
    phone.act(s => s.save(sprint()));
    await phone.sync();
    await pc.sync();
    pc.act(s => s.save(sprint({name: 'Sprint 2', savedAt: at(22)})));
    await pc.sync();
    await phone.sync();
    expect(phone.snap.presets).toHaveLength(1);
    expect(phone.snap.presets[0].name).toBe('Sprint 2');
    expect(server.doc?.presets).toHaveLength(1);
  });

  it('both edit it before either syncs: a real conflict, both kept, the newer under the id', async () => {
    phone.act(s => s.save(sprint()));
    await phone.sync();
    await pc.sync();
    phone.act(s => s.save(sprint({name: 'Phone edit', savedAt: at(22)})));
    pc.act(s => s.save(sprint({name: 'PC edit', savedAt: at(21)})));
    await phone.sync();
    await pc.sync();
    await phone.sync();
    expect(pc.snap.presets).toHaveLength(2);
    expect(pc.snap.presets.find(p => p.id === 'a')?.name).toBe('Phone edit');
    expect(pc.snap.presets.find(p => p.id !== 'a')?.name).toBe('PC edit (copy)');
    expect(phone.ids).toEqual(pc.ids);
    expect(server.doc?.presets).toHaveLength(2);
  });

  it('several edits in a row on one device never plant a copy on the other', async () => {
    phone.act(s => s.save(sprint()));
    await phone.sync();
    await pc.sync();
    for (const [day, stops] of [
      [21, 1],
      [22, 2],
      [23, 3],
    ] as const) {
      phone.act(s => s.save(sprint({mandatoryStops: stops, savedAt: at(day)})));
      await phone.sync();
      await pc.sync();
    }
    expect(pc.snap.presets).toHaveLength(1);
    expect(pc.snap.presets[0].mandatoryStops).toBe(3);
    expect(server.doc?.presets).toHaveLength(1);
  });
});

describe('who the list belongs to', () => {
  it('the first sign-in adopts the list', () => {
    phone.act(s => {
      s.save(make('mine'));
      s.adoptOwner('uid-a');
    });
    expect(phone.snap.owner).toBe('uid-a');
    expect(phone.ids).toEqual(['mine']);
    phone.act(s => s.adoptOwner('uid-a'));
    expect(phone.ids).toEqual(['mine']);
  });

  it('another person signing in starts empty and syncs on their own; the first person keeps their unsent presets for when they come back', async () => {
    const serverB = new Server();
    phone.act(s => {
      s.save(make('mine'));
      s.adoptOwner('uid-a');
    });
    expect(phone.snap.pending).toBe(true);
    // B signs in on this device before A's list was ever sent
    phone.act(s => s.adoptOwner('uid-b'));
    expect(phone.snap).toMatchObject({presets: [], owner: 'uid-b', version: 0, pending: false});
    await phone.sync(serverB);
    expect(serverB.doc).toBeNull();
    expect(server.doc).toBeNull();
    // A comes back: the list and its pending flag are there, and it syncs to A's account
    phone.act(s => s.adoptOwner('uid-a'));
    expect(phone.ids).toEqual(['mine']);
    expect(phone.snap.pending).toBe(true);
    expect(Object.keys(phone.snap.byOwner)).toEqual(['uid-b']);
    await phone.sync();
    expect(server.doc?.presets.map(p => p.id)).toEqual(['mine']);
    expect(phone.snap.pending).toBe(false);
  });

  it("what B saved on this device is B's alone", async () => {
    const serverB = new Server();
    phone.act(s => s.adoptOwner('uid-a'));
    phone.act(s => s.adoptOwner('uid-b'));
    phone.act(s => s.save(make('b-only')));
    await phone.sync(serverB);
    phone.act(s => s.adoptOwner('uid-a'));
    expect(phone.ids).toEqual([]);
    phone.act(s => s.adoptOwner('uid-b'));
    expect(phone.ids).toEqual(['b-only']);
    expect(serverB.doc?.presets.map(p => p.id)).toEqual(['b-only']);
  });
});
