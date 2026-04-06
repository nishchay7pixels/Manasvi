# @manasvi/event-bus

Canonical event publish/consume framework for Manasvi:
- transport abstraction (`InMemoryTransport`, `HttpTransport`)
- schema + integrity-validated consumption
- retry with transient-vs-terminal error handling
- dead-letter routing with reason codes
- idempotency/duplicate protection hooks
