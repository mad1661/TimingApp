"""Verdict for every points-file difference (points_cmp.py output), checked against the EDATs and stored runs.

python3 scripts/dataout-parity/points_classify.py <points.json> <app dir>   (SHOW_UNEXPLAINED=1 lists those)
A points value is getresults data when the racer's rounds in the app's EDAT
differ from the tower's (lost rows, DQs, keying errors, missing days); a row
on one side only is checked against the car's stored passes (row_verdict);
a row at another position needs a reason for the move (order_verdicts). The
rest are the documented limits — divisions, Portatree's tie order, the
national pro / FSS structure, the tower's entry list.
"""
import collections, glob, json, os, re, sys
from datetime import date, timedelta
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cmp import read, parse_edat, norm_name
from paths import ROOT, EVENT_PACKS as M
from points_cmp import parse_dp

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


def round_one(rounds):
    return {c['car'].upper() for p in rounds.get('ROUND 1', []) for c in p['cars']}


def order_verdicts(rrows, arows, ref_rb, app_rb, ref_r1, app_r1, portatree):
    """Verdict for every row the two points files place at different positions.

    The towers list racers by the round they reached — Compulink ties in
    round-1 order (as the app does), Portatree by a key not in the data — then
    everyone who never raced in one block in their entry order. The rows that
    differ for one of those reasons are set aside; the remaining racers must
    keep the same relative order, or the row is UNEXPLAINED.
    """
    apos = {r['car']: i for i, r in enumerate(arows)}
    moved = [r['car'] for i, r in enumerate(rrows) if r['car'] in apos and apos[r['car']] != i]
    if not moved:
        return {}
    rp = {r['car']: r['pts'] for r in rrows}
    ap = {r['car']: r['pts'] for r in arows}
    common = set(rp) & set(ap)
    why = {}
    for c in common:
        if rp[c] != ap[c]:
            why[c] = 'SOURCE: placed by points that differ on getresults (see the points verdicts)'
        elif c in ref_r1 and c not in app_r1:
            why[c] = "SOURCE: the car's round-1 row is missing on getresults, so the app can't place it in round-1 order"
        elif ref_rb.get(c) != app_rb.get(c):
            why[c] = "SOURCE: the racer's rounds differ on getresults (winner flag, lost rows); the tower places the corrected racer apart"

    # A racer the tower lists below racers with fewer points broke the tower's
    # own order (LO7-2 Super Street's late round-1 pair, LO7-4 Top Dragster's
    # re-run). Entry-point rows stay at their stage, so they're not a reference.
    prev = None
    for r in rrows:
        c, p = r['car'], r['pts'].strip()
        if c not in ref_rb or not p.lstrip('-').isdigit() or p == '10':
            continue
        if prev is not None and int(p) > prev and c in common and c not in why:
            why[c] = "EXCEPTION: the tower lists this racer out of its own points order (a re-run or late round-1 pair) — not derivable from the timing data"
        prev = int(p)

    def raced(c):
        return c in ref_rb or c in app_rb

    def block(rows, racers):
        return [r['car'] for r in rows if r['car'] in common and raced(r['car']) == racers and r['car'] not in why]

    nt, na = block(rrows, False), block(arows, False)
    for i, c in enumerate(nt):
        if na.index(c) != i:
            why[c] = "EXCEPTION: racers who never raced eliminations come in the tower's entry order (not in the timing data)"
    rc, ac = block(rrows, True), block(arows, True)
    if rc != ac and portatree:
        for p in {rp[c] for c in rc}:
            tg, ag = [c for c in rc if rp[c] == p], [c for c in ac if ap[c] == p]
            if tg != ag:
                for c in tg:
                    why[c] = 'EXCEPTION: Portatree orders tied points by a key not in the data'
        rc, ac = block(rrows, True), block(arows, True)
    shifted = ('SOURCE/ENTRY: shifted by rows above it (an entrant on one side only, or a row placed differently for a reason above)'
               if rc == ac else 'UNEXPLAINED: position')
    return {c: why.get(c, shifted) for c in moved}


def event_window(runs):
    """The event's date window (race-day.ts eventWindow): the test day before through start + 5."""
    s = collections.Counter(r.get('start_date') for r in runs if r.get('start_date')).most_common(1)[0][0]
    d = date(int(s[:4]), int(s[4:6]), int(s[6:8]))
    return d - timedelta(days=1), d + timedelta(days=5)


def run_day(r):
    m = re.match(r'(\d\d)/(\d\d)/(\d{4})', r.get('timestamp') or '')
    return date(int(m.group(3)), int(m.group(1)), int(m.group(2))) if m else None


def row_verdict(d, k, live, window, ref_rb):
    """A racer on one points file only, checked against the stored runs."""
    car = (re.search(r'#(\S*) ', d).group(1) or '').upper()
    rs = [r for r in live if key(r.get('category')) == k and (r.get('car_number') or '').strip().upper() == car]
    named = [r for r in rs if (r.get('name') or '').strip() or (r.get('class_index') or '').strip()]
    in_window = [r for r in rs if run_day(r) and window[0] <= run_day(r) <= window[1]]
    elims = [r for r in rs if re.match(r'^E\d+$', r.get('round') or '')]
    if 'missing from app' in d:
        if not car:
            return 'FOLDER: the tower row has no car number'
        if not rs:
            return 'SOURCE: the racer has no pass in this class on getresults'
        if not in_window:
            return "SOURCE: the racer's only passes on getresults are outside the event's dates (another race)"
        if not named:
            return ('EXCEPTION: getresults shows a bare car number (no driver, no class); the tower knows the car from its own '
                    'entry list, and leaves most such numbers out, as the app does')
        return 'UNEXPLAINED: tower entrant with passes on getresults'
    if car.startswith('M-TEST'):
        return 'APP DATA: test row "m-TEST" in the production store (throw it out on the Runs page)'
    if elims and not named:
        return 'SOURCE: a car number getresults keyed in error (no driver on any row); the tower has the racer under its right number'
    if elims and car not in ref_rb:
        return "SOURCE: getresults has this racer in eliminations the tower's file doesn't (keying / lost opponent row)"
    if elims:
        return 'EXCEPTION: the tower raced this car but left it out of its points file (points eligibility is not in the data)'
    return "EXCEPTION: the tower doesn't list this entrant (its points entry list is not in the timing data)"


def main():
    pts = json.load(open(sys.argv[1]))
    appdir = sys.argv[2]
    verdicts = collections.Counter()
    for ev, v in pts.items():
        live = json.load(open(f'{ROOT}/live/{ev}.json'))['runs']
        window = event_window(live)
        rd = glob.glob(f'{ROOT}/flat/{M[ev]}-*')[0]
        ref_e, ref_r1, ref_p = {}, {}, {}
        for p in glob.glob(rd + '/*'):
            b = os.path.basename(p).upper()
            if re.match(r'^C\d+EDAT\.TXT$', b):
                c, r = parse_edat(read(p)); ref_e[key(c)] = rounds_by_car(r); ref_r1[key(c)] = round_one(r)
            elif re.match(r'^C\d+A\w+DP\.TXT$', b):
                c, rows = parse_dp(open(p, 'rb').read().decode('latin1').replace('\r', '')); ref_p[key(c)] = rows
        app = json.load(open(f'{appdir}/{ev}.json'))
        app_e, app_r1, app_p = {}, {}, {}
        for f in app['edat']:
            c, r = parse_edat(f['content']); app_e[key(c)] = rounds_by_car(r); app_r1[key(c)] = round_one(r)
        for f in app.get('points', []):
            c, rows = parse_dp(f['content'].replace('\r', '')); app_p[key(c)] = rows
        order = {k: order_verdicts(ref_p[k], app_p[k], ref_e.get(k, {}), app_e.get(k, {}),
                                   ref_r1.get(k, set()), app_r1.get(k, set()), ev in PORTATREE)
                 for k in set(ref_p) & set(app_p)}
        r1 = lambda rb: sum(1 for v in rb.values() if v and v[0][0] == 0)
        for g, d in v['diffs']:
            cat = re.match(r'POINTS (.*?)(?::| #)', d).group(1)
            k = key(cat)
            if g == 'pts_div':
                f, a = re.search(r'division folder (\S*) vs app (\S*)', d).groups()
                verdicts['EXCEPTION: national packs print A for the division' if f == 'A'
                         else 'EXCEPTION: home division is not in the timing data and no matched tech card has one (the app prints 0 rather than guess)' if a in ('', '0')
                         else 'ENTRY: the tech card\'s home division differs from the tower\'s'] += 1
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
                why = row_verdict(d, k, live, window, ref_e.get(k, {}))
                verdicts[why] += 1
                if why.startswith('UNEXPLAINED') and os.environ.get('SHOW_UNEXPLAINED'):
                    print('UNEXPLAINED', ev, d)
            elif g == 'pts_order':
                car = re.search(r'#(\S+):', d).group(1).upper()
                why = order.get(k, {}).get(car, 'UNEXPLAINED: position')
                verdicts[why] += 1
                if why.startswith('UNEXPLAINED') and os.environ.get('SHOW_UNEXPLAINED'):
                    print('UNEXPLAINED', ev, d)
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
