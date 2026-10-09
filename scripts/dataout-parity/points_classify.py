"""Verdict for every points-file difference (points_cmp.py output), checked against the EDATs.

python3 scripts/dataout-parity/points_classify.py <points.json> <app dir>
A points value is getresults data when the racer's rounds in the app's EDAT
differ from the tower's (lost rows, DQs, keying errors, missing days); the
rest are the documented limits — divisions, Portatree's tie order, the
national pro / FSS structure, the tower's entry list.
"""
import collections, glob, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cmp import read, parse_edat, norm_name
from paths import ROOT, EVENT_PACKS as M

PORTATREE = {'13', '41', '42'}
PRO = re.compile(r'TOP FUEL|FUNNY CAR|PRO STOCK|PRO MOD|FACTORY STOCK|TOP ALCOHOL')


def key(c):
    return re.sub(r'[^A-Z0-9]', '', norm_name(c))


def rounds_by_car(rounds):
    out = collections.defaultdict(list)
    for i, prs in enumerate(rounds.values()):
        for p in prs:
            for j, c in enumerate(p['cars']):
                out[c['car'].upper()].append((i, 'W' if (p['single'] or j == 0) else 'L'))
    return out


def main():
    pts = json.load(open(sys.argv[1]))
    appdir = sys.argv[2]
    verdicts = collections.Counter()
    for ev, v in pts.items():
        rd = glob.glob(f'{ROOT}/flat/{M[ev]}-*')[0]
        ref_e = {}
        for p in glob.glob(rd + '/*'):
            if re.match(r'^C\d+EDAT\.TXT$', os.path.basename(p).upper()):
                c, r = parse_edat(read(p)); ref_e[key(c)] = rounds_by_car(r)
        app = json.load(open(f'{appdir}/{ev}.json'))
        app_e = {}
        for f in app['edat']:
            c, r = parse_edat(f['content']); app_e[key(c)] = rounds_by_car(r)
        r1 = lambda rb: sum(1 for v in rb.values() if v and v[0][0] == 0)
        for g, d in v['diffs']:
            cat = re.match(r'POINTS (.*?)(?::| #)', d).group(1)
            k = key(cat)
            if g == 'pts_div':
                verdicts['EXCEPTION: home division is not in the timing data (tech card has none; national packs print A)'] += 1
            elif g in ('pts_member', 'pts_name'):
                verdicts['ENTRY: member number / name from the tech card'] += 1
            elif g == 'pts_file':
                if 'app produced none' in d:
                    why = ("APP DATA GAP: the event's final day never reached the store (no final, no points)" if ev in ('12', 'BM1')
                           else 'EXCEPTION: pro B-points file (second pro points set) is not produced' if re.search(r'B\d+DP|B\w+DP', d)
                           else 'SOURCE: class has no final on getresults / class name differs')
                    verdicts[why] += 1
                elif 'not in folder' in d:
                    verdicts['EXTRA: the tower pack has no points file for this class (LO4-1 shipped none)' if ev == '41' else 'EXTRA: points file for a class the tower pack has none for'] += 1
                else:
                    verdicts["EXCEPTION: the tower's own C# slot for this class (pin it on the page)"] += 1
            elif g == 'pts_row':
                verdicts['SOURCE/ENTRY: entrant on one side only (tower entry list, or a racer getresults lost)'] += 1
            elif g == 'pts_order':
                verdicts['EXCEPTION: Portatree orders tied points by a key not in the data' if ev in PORTATREE
                         else 'SOURCE: order shifted by a racer missing on one side, or rounds that differ on getresults'] += 1
            elif g == 'pts_points':
                car = re.search(r'#(\S+):', d).group(1).upper()
                fpts, apts = re.search(r'points folder (\d+) vs app (\d+)', d).groups()
                rr, ar = ref_e.get(k, {}).get(car), app_e.get(k, {}).get(car)
                if PRO.search(cat.upper()):
                    verdicts['EXCEPTION: national pro / alcohol / FSS points (qualifying bonuses, session lows) approximated'] += 1
                elif rr != ar:
                    verdicts["SOURCE: the racer's rounds differ on getresults (lost rows, DQs, keying, mis-coded rounds)"] += 1
                elif r1(ref_e.get(k, {})) != r1(app_e.get(k, {})):
                    verdicts['SOURCE: the round-1 field differs on getresults, and the bracket follows the field'] += 1
                elif fpts == '10':
                    verdicts['EXCEPTION: the tower paid only entry points to a racer who raced eliminations (points eligibility is not in the data)'] += 1
                elif apts == '10' and rr is None:
                    verdicts["SOURCE: the qualifier's sheet position differs on getresults (inside the field = round-1 loss points)"] += 1
                elif re.search(r'HEMI|SHOOTOUT|MOTORCYCLE', cat.upper()):
                    verdicts['EXCEPTION: the tower scores this special class on its own table'] += 1
                else:
                    verdicts['UNEXPLAINED: same rounds and field, different points'] += 1
                    if os.environ.get('SHOW_UNEXPLAINED'):
                        print('UNEXPLAINED', ev, d, rr, ar)
    for k, n in verdicts.most_common():
        print(f'{n:5}  {k}')
    print('total', sum(verdicts.values()))


if __name__ == '__main__':
    main()
