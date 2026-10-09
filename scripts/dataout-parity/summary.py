"""Per-event match table in the audit report's groupings, from a runall results file.

python3 scripts/dataout-parity/summary.py <results.json>
"""
import json, sys

CORE = ['round', 'pairing', 'winner', 'rt', 'dial', 'et', 'mph', 'qpos', 'bye_marker', 'final_label']
RES = ['rt', 'et', 'mph']
NAMES = {'11': 'D1 LO1-1', '12': 'D1 LO1-2', '13': 'D1 LO1-3', '14': 'D1 LO1-4', '15': 'D1 LO1-5', '16': 'D1 LO1-6',
         '18': 'D1 LO1-7 (ev 18)', '24': 'D2 LO2-4', '41': 'D4 LO4-1', '42': 'NAT BL1 (ev 42)', '72': 'D7 LO7-2',
         '73': 'D7 LO7-3', '74': 'D7 LO7-4', 'BM1': 'NAT BM1', 'II1': 'NAT II1'}


def groups(v):
    c, m = v['c'], v['m']
    def agg(keys):
        return sum(m.get(k, 0) for k in keys), sum(c.get(k, 0) for k in keys)
    qkeys = ['file'] + [k for k in c if k.startswith('q_')]
    ekeys = [k for k in c if k.startswith('entry:')]
    edat_entry = [k for k in ekeys if not k.startswith('entry:q_')]
    qdat_entry = [k for k in ekeys if k.startswith('entry:q_')]
    return {
        'core': agg(CORE), 'res': agg(RES), 'win': agg(['winner']), 'pair': agg(['pairing']),
        'qdat': agg(qkeys), 'entry': agg(ekeys),
        'edat_all': agg(CORE + edat_entry), 'qdat_all': agg([k for k in qkeys if k != 'file'] + qdat_entry),
        'file': agg(['file']),
    }


def pct(t):
    m, c = t
    return f'{m}/{c} ({100.0 * m / c:.1f}%)' if c else 'n/a'


def main():
    r = json.load(open(sys.argv[1]))
    cols = ['core', 'res', 'win', 'pair', 'qdat', 'entry']
    print('| Event | Core results | ET/MPH/RT | Winners | Pairings | QDAT | Entry fields |')
    print('|---|---|---|---|---|---|---|')
    tot = {k: [0, 0] for k in cols}
    for ec, v in r.items():
        g = groups(v)
        for k in cols:
            tot[k][0] += g[k][0]; tot[k][1] += g[k][1]
        print(f'| {NAMES.get(ec, ec)} | ' + ' | '.join(pct(g[k]) for k in cols) + ' |')
    print('| **All 15** | ' + ' | '.join(pct(tuple(tot[k])) for k in cols) + ' |')


if __name__ == '__main__':
    main()
