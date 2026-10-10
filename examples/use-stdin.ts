import {
  createChannel,
  type Operation,
  race,
  resource,
  spawn,
  type Stream,
  suspend,
  until,
} from "effection";
import process from "node:process";

export function useStdin(): Operation<Stream<Uint8Array, void>> {
  return resource(function* (provide) {
    // The reader must not start until the stream is subscribed. Channels only
    // deliver to subscribers that already exist, so anything read earlier is
    // dropped. Starting on subscription is safe: probe replies and early
    // keystrokes wait in the OS pty buffer until the first read begins.
    let subscribed = false;
    let stream: Stream<Uint8Array, void> = {
      *[Symbol.iterator]() {
        if (subscribed) {
          throw new Error("useStdin stream supports exactly one subscription");
        }
        subscribed = true;

        let channel = createChannel<Uint8Array, void>();
        let iterator = process.stdin.iterator() as AsyncIterator<Uint8Array>;

        yield* spawn(function* () {
          let next = yield* until(iterator.next());
          while (!next.done) {
            yield* channel.send(next.value);
            next = yield* until(iterator.next());
          }
          yield* channel.close();
        });

        return yield* channel;
      },
    };

    yield* race([provide(stream), suspend()]);
  });
}
