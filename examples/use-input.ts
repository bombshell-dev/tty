import {
  call,
  createChannel,
  each,
  type Operation,
  race,
  resource,
  sleep,
  spawn,
  type Stream,
  suspend,
  until,
} from "effection";
import { createInput, type InputEvent, type InputOptions } from "../mod.ts";

function nothing() {
  return suspend() as unknown as Operation<
    IteratorResult<Uint8Array, void>
  >;
}

export function useInput(
  stream: Stream<Uint8Array, void>,
  options?: InputOptions,
): Stream<InputEvent, void> {
  return resource(function* (provide) {
    let input = yield* until(createInput(options));
    let subscription = yield* stream;

    let pending = nothing();

    let events = createChannel<InputEvent, void>();

    yield* spawn(function* () {
      let next = yield* subscription.next();
      while (!next.done) {
        let result = input.scan(next.value);
        pending = result.pending ? rescan(result.pending.delay) : nothing();
        for (let event of result.events) {
          yield* events.send(event);
        }
        next = yield* race([subscription.next(), pending]);
      }
      yield* events.close();
    });

    yield* race([provide(yield* events), drain(events)]);
  });
}

function rescan(delay: number): ReturnType<typeof nothing> {
  return call(function* (): Operation<IteratorResult<Uint8Array, void>> {
    yield* sleep(delay);
    return {
      done: false,
      value: new Uint8Array(),
    };
  });
}

function* drain<T, TClose>(stream: Stream<T, TClose>): Operation<void> {
  for (let _ of yield* each(stream)) {
    yield* each.next();
  }
}
