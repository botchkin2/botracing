// A path segment the API takes from a client (an id, a file name): the one
// rule every upload route and the heartbeat's hostId share.
export const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,199}$/;
