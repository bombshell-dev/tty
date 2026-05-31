import {
  createChannel,
  each,
  type Operation,
  race,
  resource,
  spawn,
  type Stream,
  until,
} from "effection";

export function useStdin(): Operation<Stream<Uint8Array, void>> {
  return resource(function* (provide) {
    let channel = createChannel<Uint8Array, void>();

    let iterator = Deno.stdin.readable[Symbol.asyncIterator]();

    yield* spawn(function* () {
      let next = yield* until(iterator.next());
      while (!next.done) {
        yield* channel.send(next.value);
        next = yield* until(iterator.next());
      }
      yield* channel.close();
    });

    yield* race([provide(channel), drain(channel)]);
  });
}

function* drain<T, TClose>(stream: Stream<T, TClose>): Operation<void> {
  for (let _ of yield* each(stream)) {
    yield* each.next();
  }
}
