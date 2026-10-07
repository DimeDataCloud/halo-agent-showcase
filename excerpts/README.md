# Excerpts

Three files from the private HALO Agent OS source, copied unchanged apart from a header
(and, for `routines-schedule.ts`, the parts of the file that aren't shown). Each one is pure
logic with no I/O, so it reads on its own.

| File | Why it's here |
|---|---|
| [`zoned-time.ts`](zoned-time.ts) | Wall-clock times in a named zone with no date library. A routine set for 08:00 means 08:00 where the owner is, not where the container is. The interesting part is `instantForZonedWallClock`, which reads its own answer back so a spring-forward gap fires once, just after the gap, instead of an hour early. |
| [`routines-schedule.ts`](routines-schedule.ts) | The five schedule kinds, and how an event (a calendar entry starting, a message arriving) enters an agent's prompt: fenced and labelled as data, never as an instruction. |
| [`today.ts`](today.ts) | The home screen, computed from state with no model call. One ranked Needs-you list: an approval outranks a question, which outranks a returned hand-off, a failed routine and a missed one. |

These files aren't licensed for reuse, except the upstream lines marked at the top of
`routines-schedule.ts`, which stay MIT. They're here to show how the product is built.
