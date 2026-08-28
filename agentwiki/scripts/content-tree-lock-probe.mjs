import { setTimeout as wait } from 'node:timers/promises';

export async function runBlockingLockProbe({
  startFirst,
  startSecond,
  assertBlocked,
  holdMs = 50,
}) {
  let signalFirstStarted;
  let releaseFirst;
  const firstStarted = new Promise((resolve) => { signalFirstStarted = resolve; });
  const firstHold = new Promise((resolve) => { releaseFirst = resolve; });
  let firstPromise;
  let secondPromise;
  let failure;
  let settlements = [];
  try {
    firstPromise = Promise.resolve().then(() => startFirst({
      hold: firstHold,
      signalStarted: signalFirstStarted,
    }));
    const firstSettledTooEarly = firstPromise.then(
      () => { throw new Error('first lock transaction settled before signaling acquisition'); },
      (error) => { throw error; },
    );
    await Promise.race([firstStarted, firstSettledTooEarly]);
    secondPromise = Promise.resolve().then(() => startSecond());
    await wait(holdMs);
    await assertBlocked();
  } catch (error) {
    failure = error;
  } finally {
    releaseFirst();
    settlements = await Promise.allSettled(
      [firstPromise, secondPromise].filter(Boolean),
    );
  }
  if (failure) throw failure;
  return settlements;
}
