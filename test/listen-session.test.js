import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ListenSession } from '../public/listen-session.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(count = 12) {
  const generated = [], played = [], shown = [], errors = [], requests = [], playback = [];
  let completed = 0;
  const session = new ListenSession({
    nextPage: page => page.number + 1 < count ? { number: page.number + 1 } : null,
    generate: (page, signal) => {
      generated.push(page.number);
      const pending = deferred();
      requests.push({ ...pending, signal });
      return pending.promise;
    },
    play: (audio, signal) => {
      played.push(audio);
      const pending = deferred();
      playback.push({ ...pending, signal });
      return pending.promise;
    },
    onPage: page => shown.push(page.number),
    onError: error => errors.push(error.message),
    onComplete: () => completed++,
  });
  session.start({ number: 0 });
  return { session, generated, played, shown, errors, requests, playback, completed: () => completed };
}

test('starts the current page immediately, prefetches only five, and replenishes on auto turn', async () => {
  const state = setup();
  assert.deepEqual(state.generated, [0]);
  state.requests[0].resolve('audio0');
  await tick();
  assert.deepEqual(state.played, ['audio0']);
  assert.deepEqual(state.shown, [0]);
  for (let i = 1; i <= 5; i++) {
    assert.equal(state.requests.length, i + 1);
    state.requests[i].resolve('audio' + i);
    await tick();
  }
  assert.deepEqual(state.generated, [0, 1, 2, 3, 4, 5]);
  assert.equal(state.session.entries.length, 6);
  // Pausing the audio (leaving its promise unresolved) never grows the window.
  await tick();
  assert.equal(state.requests.length, 6);
  state.playback[0].resolve();
  await tick();
  assert.deepEqual(state.shown, [0, 1]);
  assert.deepEqual(state.played, ['audio0', 'audio1']);
  assert.deepEqual(state.generated, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(state.session.entries.length, 6);
  assert.equal(state.session.entries[0].page.number, 1);
  state.session.stop();
});

test('waits for a slow next page without skipping it or playing out of order', async () => {
  const state = setup(3);
  state.requests[0].resolve('first');
  await tick();
  state.playback[0].resolve();
  await tick();
  assert.deepEqual(state.shown, [0, 1]);
  assert.deepEqual(state.played, ['first']);
  state.requests[1].resolve('second');
  await tick();
  assert.deepEqual(state.played, ['first', 'second']);
  state.session.stop();
});

test('stopping aborts playback and pending generation, clears the buffer, and ignores late audio', async () => {
  const state = setup();
  state.requests[0].resolve('first');
  await tick();
  state.session.stop();
  assert.equal(state.requests[1].signal.aborted, true);
  assert.equal(state.playback[0].signal.aborted, true);
  assert.equal(state.session.entries.length, 0);
  state.requests[1].resolve('stale');
  state.playback[0].resolve();
  await tick();
  assert.deepEqual(state.played, ['first']);
  assert.deepEqual(state.shown, [0]);
  assert.equal(state.generated.length, 2);
});

test('finishes at the end of the book without wrapping around', async () => {
  const state = setup(2);
  state.requests[0].resolve('first');
  await tick();
  state.requests[1].resolve('second');
  await tick();
  state.playback[0].resolve();
  await tick();
  state.playback[1].resolve();
  await tick();
  assert.deepEqual(state.shown, [0, 1]);
  assert.equal(state.completed(), 1);
  assert.equal(state.session.active, false);
  assert.equal(state.session.entries.length, 0);
});

test('a failed prefetched page does not interrupt current playback and reports when needed', async () => {
  const state = setup(2);
  state.requests[0].resolve('first');
  await tick();
  state.requests[1].reject(Error('Speech unavailable'));
  await tick();
  assert.deepEqual(state.errors, []);
  state.playback[0].resolve();
  await tick();
  assert.deepEqual(state.errors, ['Speech unavailable']);
  assert.deepEqual(state.played, ['first']);
  assert.equal(state.session.active, false);
});

test('stopping before the first audio is ready prevents late playback', async () => {
  const state = setup();
  state.session.stop();
  assert.equal(state.requests[0].signal.aborted, true);
  state.requests[0].resolve('late audio');
  await tick();
  assert.deepEqual(state.played, []);
  assert.deepEqual(state.generated, [0]);
  assert.equal(state.session.entries.length, 0);
});
