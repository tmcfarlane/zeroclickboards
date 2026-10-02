# Integrated toolbar verification

The freshly built combined app passed three unchanged geometry cases: desktop1280 AIopen, desktop640 AIopen, and mobile390 AIclosed. The tested frontend source, public assets, dependency locks and build settings match this toolbar branch exactly after inheriting PR46. One worker, zero retries. The full combined app/API gate separately passes989/989; this is broader coverage and includes MCP backend changes that are outside the browser bundle.

Screenshots and geometry measurements come from that immutable compiled fixture build. Root visually reviewed desktop1280. An initial private anchored grep selected no tests; its bootstrap attempt is preserved in the MCP final QA. Only the selection regex was corrected before the actual three-case run. Original before/after13-case evidence is retained in the parent QA directory.
