---
'luojiahai-skills': patch
---

archiver (x): accept `--full`, `--browser` and `--cookies`

All three were documented and none were reachable — X parsed its command line
with the shared defaults, which name neither, so each was refused as an unknown
option. `--browser NAME` additionally handed `NAME` to the URL slot, letting a
flag decide which account got archived. X now declares its own flag sets, as
Douyin does.
