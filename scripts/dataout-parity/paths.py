"""Where the parity check keeps its working data (never committed — the tower
packs and snapshots carry racer names): $DATAOUT_PARITY_DIR, else
<repo>/.dataout-parity.

  flat/<pack>/      one folder per tower RACEDATA pack, files flattened (unpack_refs.py)
  live/<ev>.json    read-only snapshot of the stored runs (fetch_live.py)
  app_<tag>/        an export replayed over the snapshot (replay.ts)
"""
import os

ROOT = os.environ.get(
    'DATAOUT_PARITY_DIR',
    os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), '.dataout-parity'),
)

# App event → the tower pack it is compared with (2026 tiebreaker folder).
EVENT_PACKS = {
    '11': 'D1-LO11', '12': 'D1-LO12', '13': 'D1-LO13', '14': 'D1-LO14', '15': 'D1-LO15', '16': 'D1-LO16',
    '18': 'D1-LO17', '24': 'D2-LO24', '41': 'D4-LO41', '42': 'NAT-BL1', '72': 'D7-LO72', '73': 'D7-LO73',
    '74': 'D7-LO74', 'BM1': 'NAT-BM1', 'II1': 'NAT-II1',
}
