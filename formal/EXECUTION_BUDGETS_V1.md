# Formal-methods local execution budgets v1

A manifest that passes byte and shape validation must still be bounded before it
can construct a verifier command or launch an adapter. The local v1 profile uses
hard ceilings that a manifest may lower but never raise.

| Requested field | Local v1 maximum |
| --- | ---: |
| execution timeout | 21,600 seconds (6 hours) |
| captured output | 67,108,864 bytes (64 MiB) |
| simulation samples | 1,000,000 |
| simulation steps | 100,000 |
| simulation samples × steps | 100,000,000 |
| Apalache verification steps | 100,000 |
| generated trace count | 10,000 |
| generated trace steps | 100,000 |
| trace-generator samples | 1,000,000 |
| trace count × steps | 100,000,000 |
| trace samples × steps | 100,000,000 |

All products use checked arithmetic. Overflow is a validation failure rather than
wrapping into an apparently small request. Validation happens before plan
construction and process launch.

These are repository/local maxima. A future service profile may lower any value,
but it must not let a manifest raise service policy. Recording both requested and
effective values in signed/provenance reports is a separate DEN-1406 child.
