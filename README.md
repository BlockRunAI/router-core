# @blockrun/router-core

Deterministic, constraint-first model routing shared by BlockRun products.

The package is deliberately product-neutral. It contains task classification,
hard capability filtering, portfolio scoring, ordered fallbacks, and routing
configuration. It does not contain a wallet, gateway client, proxy server,
agent loop, payment handling, telemetry transport, or benchmark runner.

Hosts provide request capabilities and current model pricing. They may also
override model capability and performance observations without introducing a
network call on the routing hot path.

```ts
import { DEFAULT_ROUTING_CONFIG, route } from "@blockrun/router-core";

const decision = route(prompt, systemPrompt, maxOutputTokens, {
  config: DEFAULT_ROUTING_CONFIG,
  modelPricing,
  hasTools: true,
  requiresTools: true,
});
```

Routing is local and deterministic for identical inputs, configuration, model
metadata, and time.
