# opto_sync_state_flutter

`StoreListenable` adapts a `StateStore` selection to Flutter's read-only
`ValueListenable` interface. Use it with `ValueListenableBuilder`, or let the
application's existing Provider/BLoC own it. It adds no alternate sync queue.

Create a selection once under the widget/provider owner and dispose it with
that owner. The session/application separately owns the store. A selector
replays the current value and rebuilds only when its selected value changes.
Writable state is accessible only through the store dispatcher.

See [CLIENT_STATE.md](../../docs/CLIENT_STATE.md) for usage, session fences, queue
integration, Flutter web, and native Android/iOS/desktop isolate execution.

```sh
flutter pub get
flutter analyze
flutter test
```
