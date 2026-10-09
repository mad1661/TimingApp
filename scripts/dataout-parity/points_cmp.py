"""Compare the tower's CxAyyDP points files with the app's, class by class.

points_cmp.py <appdir> [out.json]  — per event: file presence, row presence,
points, division, member, name and position (row order).
"""
import glob, json, os, re, sys, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cmp import read, norm_name

from paths import ROOT, EVENT_PACKS as M


def key(cat):
    return re.sub(r'[^A-Z0-9]', '', norm_name(cat))


def parse_dp(txt):
    lines = txt.replace('\x1a', '').split('\n')
    m = re.match(r'.*EVENT Points for (.*?) w/REG code', lines[0].strip())
    cat = m.group(1).strip() if m else lines[0].strip()
    rows = []
    for l in lines[1:]:
        l = l.strip()
        if not l or l.startswith('End of File'):
            break
        f = l.split(',')
        if len(f) >= 6:
            rows.append({'car': f[0].upper(), 'member': f[1], 'name': ','.join(f[2:len(f) - 3]), 'div': f[-3], 'pts': f[-2]})
    return cat, rows


def compare(appdir):
    out = {}
    for ev, pre in M.items():
        rd = glob.glob(f'{ROOT}/flat/{pre}-*')[0]
        app = json.load(open(f'{appdir}/{ev}.json'))
        c, m, diffs = collections.Counter(), collections.Counter(), []

        def add(g, ok, d=None):
            c[g] += 1
            if ok:
                m[g] += 1
            elif d:
                diffs.append((g, d))
        ref = {}
        for p in glob.glob(rd + '/*'):
            b = os.path.basename(p).upper()
            if re.match(r'^C\d+A\w+DP\.TXT$', b):
                cat, rows = parse_dp(open(p, 'rb').read().decode('latin1').replace('\r', ''))
                ref[key(cat)] = (b, cat, rows)
        mine = {}
        for f in app.get('points', []):
            cat, rows = parse_dp(f['content'].replace('\r', ''))
            mine[key(cat)] = (f['filename'], cat, rows)
        for k in sorted(set(ref) | set(mine)):
            if k not in mine:
                add('pts_file', False, f'POINTS {ref[k][1]}: in folder ({ref[k][0]}) but app produced none')
                continue
            if k not in ref:
                add('pts_file', False, f'POINTS {mine[k][1]}: in app ({mine[k][0]}) but not in folder')
                continue
            add('pts_file', ref[k][0] == mine[k][0].upper(), f'POINTS {ref[k][1]}: file name folder {ref[k][0]} vs app {mine[k][0]}')
            rrows, arows = ref[k][2], mine[k][2]
            apos = {r['car']: (i, r) for i, r in enumerate(arows)}
            for i, r in enumerate(rrows):
                x = apos.get(r['car'])
                if not x:
                    add('pts_row', False, f"POINTS {ref[k][1]}: #{r['car']} {r['name']} ({r['pts']} pts) missing from app")
                    continue
                j, a = x
                add('pts_row', True)
                add('pts_points', a['pts'] == r['pts'], f"POINTS {ref[k][1]} #{r['car']}: points folder {r['pts']} vs app {a['pts']}")
                add('pts_order', i == j, f"POINTS {ref[k][1]} #{r['car']}: position folder {i + 1} vs app {j + 1}")
                add('pts_div', a['div'] == r['div'], f"POINTS {ref[k][1]} #{r['car']}: division folder {r['div']} vs app {a['div']}")
                add('pts_member', a['member'].lstrip('0') == r['member'].lstrip('0'), f"POINTS {ref[k][1]} #{r['car']}: member folder {r['member']} vs app {a['member']}")
                add('pts_name', norm_name(a['name']) == norm_name(r['name']), f"POINTS {ref[k][1]} #{r['car']}: name folder {r['name']} vs app {a['name']}")
            rset = {r['car'] for r in rrows}
            for a in arows:
                if a['car'] not in rset:
                    add('pts_row', False, f"POINTS {ref[k][1]}: app lists #{a['car']} {a['name']} ({a['pts']} pts) not in folder")
        out[ev] = {'c': dict(c), 'm': dict(m), 'diffs': diffs}
    return out


if __name__ == '__main__':
    r = compare(sys.argv[1])
    if len(sys.argv) > 2:
        json.dump(r, open(sys.argv[2], 'w'), indent=1)
    tot_c, tot_m = collections.Counter(), collections.Counter()
    for ev, v in r.items():
        tot_c.update(v['c']); tot_m.update(v['m'])
        print(ev, ' '.join(f"{g}={v['m'].get(g, 0)}/{n}" for g, n in sorted(v['c'].items())))
    print('ALL', ' '.join(f"{g}={tot_m.get(g, 0)}/{n} ({100 * tot_m.get(g, 0) / n:.1f}%)" for g, n in sorted(tot_c.items())))
