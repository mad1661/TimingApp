"""Byte-level comparison: the raw text of the result fields, not their numeric value.

python3 scripts/dataout-parity/exact_cmp.py <app dir from replay.ts> [out.json]

cmp.py compares numbers (" -.021" == "- .021"); this compares the characters the
tower wrote. Per event: EDAT header line, result fields (class, Q pos, RT, dial,
ET, MPH) on lines matched by round + car, SINGLE markers, whole lines; QDAT
header / Low ET / Top Speed lines and the three result columns.
"""
import glob, json, os, re, sys, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cmp import read, norm_name

from paths import ROOT, EVENT_PACKS as M


def raw_lines(txt):
    return txt.split('\x1a')[0].replace('\r', '').split('\n')


def edat_lines(txt):
    out = {}  # (round index, car) -> raw line
    singles = {}
    lines = raw_lines(txt)
    rnd = -1
    prev_car = None
    for l in lines[1:]:
        if l.startswith('End of File'):
            break
        if re.match(r'^(ROUND \d+|FINALS)\s*$', l):
            rnd += 1
            continue
        f = l.split(',')
        if f[0].upper() == 'SINGLE' or f[0] == '':
            if prev_car:
                singles[(rnd, prev_car)] = l
            continue
        prev_car = f[0].upper()
        out[(rnd, prev_car)] = l
    return lines[0], out, singles


def qdat_parts(txt):
    lines = raw_lines(txt)
    low = next((l for l in lines[1:4] if l.startswith('Low ET')), None)
    top = next((l for l in lines[1:4] if l.startswith('Top Speed')), None)
    ents = {}
    for l in lines[1:]:
        if l.startswith('End of File'):
            break
        if l.startswith('Low ET') or l.startswith('Top Speed') or not l.strip():
            continue
        f = l.split(',')
        ents[f[0].upper()] = f
    return lines[0], low, top, ents


def key(cat):
    return re.sub(r'[^A-Z0-9]', '', norm_name(cat))


def head_cat(line, kind):
    m = re.match(r'(?:Compulink StarTrak|Portatree|\S+ StarTrak)\s+(.*?) (?:Elimination Results|Qualifying for \d+ entries)', line.strip())
    return m.group(1) if m else line


def compare(appdir):
    res = {}
    for ev, pre in M.items():
        rd = glob.glob(f'{ROOT}/flat/{pre}-*')[0]
        app = json.load(open(f'{appdir}/{ev}.json'))
        c, m = collections.Counter(), collections.Counter()

        def add(g, ok):
            c[g] += 1
            m[g] += 1 if ok else 0
        ref_e, ref_q = {}, {}
        for p in glob.glob(rd + '/*'):
            b = os.path.basename(p).upper()
            t = open(p, 'rb').read().decode('latin1')
            if re.match(r'^C\d+EDAT\.TXT$', b):
                ref_e[key(head_cat(t.split('\n')[0], 'e'))] = t
            elif re.match(r'^C\d+QDAT\.TXT$', b):
                ref_q[key(head_cat(t.split('\n')[0], 'q'))] = t
        app_e = {key(head_cat(f['content'].split('\n')[0], 'e')): f['content'] for f in app['edat']}
        app_q = {key(head_cat(f['content'].split('\n')[0], 'q')): f['content'] for f in app['qdat']}
        for k in set(ref_e) & set(app_e):
            rh, rl, rs = edat_lines(ref_e[k])
            ah, al, as_ = edat_lines(app_e[k])
            add('edat_header', rh.rstrip() == ah.rstrip())
            for kk, line in rl.items():
                a = al.get(kk)
                if a is None:
                    continue
                rf, af = line.split(','), a.split(',')
                rf += [''] * (12 - len(rf)); af += [''] * (12 - len(af))
                for i, name in ((2, 'edat_cls'), (3, 'edat_qpos'), (8, 'edat_rt'), (9, 'edat_dial'), (10, 'edat_et'), (11, 'edat_mph')):
                    add(name, rf[i] == af[i])
                add('edat_line', line == a)
                add('edat_line_ex_engine', rf[:7] + rf[8:] == af[:7] + af[8:])
                add('edat_line_results', [rf[0], rf[2], rf[3]] + rf[8:12] == [af[0], af[2], af[3]] + af[8:12])
            for kk, line in rs.items():
                if kk in as_:
                    add('edat_single', line == as_[kk])
        for k in set(ref_q) & set(app_q):
            rh, rlow, rtop, rents = qdat_parts(ref_q[k])
            ah, alow, atop, aents = qdat_parts(app_q[k])
            add('qdat_header', rh.rstrip() == ah.rstrip())
            if rlow or alow:
                add('qdat_lowet', (rlow or '').rstrip() == (alow or '').rstrip())
            if rtop or atop:
                add('qdat_topspeed', (rtop or '').rstrip() == (atop or '').rstrip())
            for car, rf in rents.items():
                af = aents.get(car)
                if not af:
                    continue
                rf += [''] * (13 - len(rf)); af += [''] * (13 - len(af))
                for i, name in ((10, 'qdat_et'), (11, 'qdat_col2'), (12, 'qdat_col3')):
                    add(name, rf[i] == af[i])
        res[ev] = {'c': dict(c), 'm': dict(m)}
    return res


if __name__ == '__main__':
    r = compare(sys.argv[1])
    if len(sys.argv) > 2:
        json.dump(r, open(sys.argv[2], 'w'), indent=1)
    tc, tm = collections.Counter(), collections.Counter()
    for ev, v in r.items():
        tc.update(v['c']); tm.update(v['m'])
    for g in sorted(tc):
        print(f'{g:15} {tm[g]}/{tc[g]} ({100 * tm[g] / tc[g]:.1f}%)')
