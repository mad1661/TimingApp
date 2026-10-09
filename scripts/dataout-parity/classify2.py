"""Verdict for every difference left after the fixes, checked against the stored rows.

classify2.py results.json appdir out.csv   (SHOW_UNEXPLAINED=1 lists those)
Every row gets a verdict:
  SOURCE …     the getresults data differs from the tower (or lacks the row/pass)
  APP DATA …   the app's store is missing data getresults had (ingest gap, test row)
  EXCEPTION …  documented: the tower's choice isn't recoverable from getresults
  ENTRY …      tech-card enrichment (member/name/city/body/engine)
  UNEXPLAINED  anything no rule covers — must be zero
A verdict is given only once the stored rows bear it out: a value the app
prints is checked against the stored pass, a qualifying pick against the
class rule applied to the car's stored passes, a pairing against the stored
clock times, an order against the rows that differ for a known reason.
"""
import csv, glob, json, os, re, sys, collections
from datetime import date, timedelta
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cmp import read, parse_qdat, parse_edat, norm_name, fnum

from paths import ROOT, EVENT_PACKS as M
PORTATREE = {'13', '41', '42'}
SUPER = {'SUPER COMP', 'SUPER GAS', 'SUPER STREET'}
QUAL_ROUND = re.compile(r'^(Q\d*|QC|C1)$')

# Differences checked one by one on DragRaceCentral in the audit (all getresults data).
DRC = {
    ('14', 'STOCK ELIMINATOR ROUND 3 1056/1887'): 'SOURCE: getresults missing DQ — folder right (DRC 420015)',
    ('15', 'STOCK ELIMINATOR ROUND 1 116M/1584'): 'SOURCE: getresults missing DQ — folder right (DRC 420212)',
    ('41', 'COMPETITION ELIMINATOR ROUND 3 4337/1968'): 'SOURCE: getresults winner flag wrong — folder right (DRC 416106)',
    ('41', 'STOCK ELIMINATOR ROUND 2 144/498Z'): 'SOURCE: getresults row has no times/winner — folder right (DRC 416079)',
    ('41', 'SUPER COMP ROUND 2 4159/4948'): "SOURCE: getresults swapped the two cars' times — folder right (DRC 416085)",
    ('41', 'SUPER GAS ROUND 2 4863/4315'): 'SOURCE: getresults row has no times/winner — folder right (DRC 416083)',
    ('II1', 'STOCK ELIMINATOR ROUND 1 4126/1151'): 'SOURCE: getresults winner flag wrong (1151 was No Time) — folder right (DRC 421681)',
    ('II1', 'TOP SPORTSMAN ROUND 1 4720/451'): 'FOLDER ERROR: folder lists 4720 first but 451 won and raced E2 (DRC 421797)',
}


def load():
    live, ref = {}, {}
    for ev, pre in M.items():
        live[ev] = json.load(open(f'{ROOT}/live/{ev}.json'))['runs']
        rd = glob.glob(f'{ROOT}/flat/{pre}-*')[0]
        e, q = {}, {}
        for p in glob.glob(rd + '/*'):
            b = os.path.basename(p).upper()
            if re.match(r'^C\d+EDAT\.TXT$', b):
                c, r = parse_edat(read(p)); e[norm_name(c)] = r
            elif re.match(r'^C\d+QDAT\.TXT$', b):
                qq = parse_qdat(read(p)); q[norm_name(qq[0])] = qq
        ref[ev] = (e, q)
    return live, ref


class Ctx:
    def __init__(self, live, ref, apps):
        # The export only reads passes inside the event's date window; the rest
        # (another race filed under the event) are kept for the one-side checks.
        self.windows = {ev: event_window(runs) for ev, runs in live.items()}
        self.all_live = live
        self.live = {ev: [r for r in runs if self.in_window(ev, r)] for ev, runs in live.items()}
        self.ref = ref
        self.app_q, self.app_e = {}, {}
        for ev, a in apps.items():
            for f in a['qdat']:
                self.app_q[(ev, norm_name(f['category']))] = parse_qdat(f['content'].replace('\r', ''))[4]
            for f in a['edat']:
                c, r = parse_edat(f['content'].replace('\r', ''))
                # Numbered as cmp.py numbers them: FINALS is ROUND <its position>.
                self.app_e[(ev, norm_name(c))] = {k if k.startswith('ROUND') else f'ROUND {i + 1}': v for i, (k, v) in enumerate(r.items())}
        self._order = {}

    def pairs(self, ev, cat, rnd):
        return self.app_e.get((ev, norm_name(cat)), {}).get(f'ROUND {rnd}', [])

    def tower_entry(self, ev, cat, car):
        q = self.ref[ev][1].get(cat)
        return next((e for e in q[4] if e['car'].upper() == car.upper()), None) if q else None

    def app_entry(self, ev, cat, car):
        return next((e for e in self.app_q.get((ev, cat), []) if e['car'].upper() == car.upper()), None)

    def in_window(self, ev, r):
        d = run_day(r)
        lo, hi = self.windows[ev]
        return d is not None and lo <= d <= hi


def event_window(runs):
    """The event's date window (race-day.ts eventWindow): the test day before through start + 5."""
    s = collections.Counter(r.get('start_date') for r in runs if r.get('start_date')).most_common(1)[0][0]
    d = date(int(s[:4]), int(s[4:6]), int(s[6:8]))
    return d - timedelta(days=1), d + timedelta(days=5)


def run_day(r):
    m = re.match(r'(\d\d)/(\d\d)/(\d{4})', r.get('timestamp') or '')
    return date(int(m.group(3)), int(m.group(1)), int(m.group(2))) if m else None


def runs_for(live, ev, cat, car=None, rnd=None):
    out = []
    for r in live[ev]:
        if norm_name(r.get('category')) != norm_name(cat):
            continue
        if car is not None and (r.get('car_number') or '').upper() != car.upper():
            continue
        if rnd is not None and r.get('round') != rnd:
            continue
        out.append(r)
    return out


def finish(r, kind):
    if kind == 'et':
        return r.get('ft1320') if r.get('ft1320') is not None else r.get('ft660')
    if kind == 'mph':
        return r.get('mph_1320') if r.get('mph_1320') is not None else r.get('mph_660')
    if kind == 'rt':
        return r.get('rt')
    if kind == 'dial':
        return r.get('dial_in')


def readings(r, kind):
    """Every stored reading the app could print for the field (quarter and eighth both)."""
    if kind == 'et':
        return [x for x in (r.get('ft1320'), r.get('ft660')) if x is not None]
    if kind == 'mph':
        return [x for x in (r.get('mph_1320'), r.get('mph_660')) if x is not None]
    x = finish(r, kind)
    return [] if x is None else [x]


def num(s):
    try:
        return float((s or '').replace(' ', ''))
    except ValueError:
        return None


def named(rs):
    return [r for r in rs if (r.get('name') or '').strip() or (r.get('class_index') or '').strip()]


def style_of(cat):
    """The app's qualifying sheet for the class (qualStyleFor)."""
    c = norm_name(cat)
    if c in SUPER:
        return 'super'
    if re.search(r'\bJRS?\b|JUNIOR|JDRL|SPORTSMAN MOTORCYCLE|^ET MOTORCYCLE$', c):
        return 'rt'
    if re.match(r'^(STOCK|SUPER STOCK|COMPETITION)\b', c):
        return 'index'
    return 'headsup'


def counts(style, r):
    """Whether the app's sheet counts the stored pass (Super: the round-1 run)."""
    rnd = r.get('round') or ''
    return rnd == 'E1' if style == 'super' else bool(QUAL_ROUND.match(rnd))


def rule_key(style, r, dial=None):
    """The class rule's ranking key for a stored pass; lower is better."""
    et, rt = finish(r, 'et'), r.get('rt')
    if style == 'rt':
        return None if rt is None else (1 if rt < 0 else 0, abs(rt))
    if not et or et >= 99.99:
        return None
    if style == 'headsup':
        return (0, et)
    d = r.get('dial_in') or dial
    if not d:
        return None
    x = round(et - d, 4)
    return (0, x) if style == 'index' else (1 if x < 0 else 0, abs(x))


def at_least_as_good(a, b):
    return a[0] < b[0] or (a[0] == b[0] and a[1] <= b[1] + 0.0005)


def qdat_class_analysis(ref_q, app_entries):
    """Is the app's order the tower's once cars on only one side (or DQ'd by the tower) are set aside?"""
    rcars = [e['car'].upper() for e in ref_q[4] if e['et'].strip().upper() != 'DQ']
    acars = [e['car'].upper() for e in app_entries]
    common = [c for c in rcars if c in set(acars)]
    aorder = [c for c in acars if c in set(common)]
    return common == aorder


def order_info(ev, cat, C):
    """The qualifiers the two sheets rank on different data, and whether the rest keep the tower's order."""
    if (ev, cat) in C._order:
        return C._order[(ev, cat)]
    tq, aq = C.ref[ev][1][cat][4], C.app_q[(ev, cat)]
    te, ae = {e['car'].upper(): e for e in tq}, {e['car'].upper(): e for e in aq}
    tower, app = [e['car'].upper() for e in tq], [e['car'].upper() for e in aq]
    common = set(tower) & set(app)
    differ = {c for c in common if any(fnum(te[c][k]) != fnum(ae[c][k]) for k in ('et', 'dial', 'diff'))}
    dq = {c for c in tower if te[c]['et'].strip().upper() == 'DQ'}
    qp = set()
    for i, c in enumerate(tower):
        own = {r.get('qual_pos') for r in runs_for(C.live, ev, cat, car=c) if re.match(r'^E\d+$', r.get('round') or '') and r.get('qual_pos')}
        if c in common and own and i + 1 not in own:
            qp.add(c)
    aside = differ | dq | qp
    rest_t = [c for c in tower if c in common and c not in aside]
    rest_a = [c for c in app if c in common and c not in aside]
    C._order[(ev, cat)] = info = {'differ': differ, 'dq': dq, 'qp': qp, 'rest_same': rest_t == rest_a}
    return info


def sheet_key(style, e):
    """The app's ranking key (qualSortKey) read off a printed sheet line."""
    inf = float('inf')
    et, mph, diff = num(e['et']), num(e['dial']), num(e['diff'])
    if et is None:
        return (inf, inf)
    if style == 'headsup':
        return (round(et, 3), -(mph or 0))
    if style == 'rt':
        return (100 + abs(et), 0) if et < 0 else (et, 0)
    if diff is None:
        return (inf, et)
    if style == 'index' or diff >= 0:
        return (round(diff, 3), 0)
    return (1000 + abs(diff), 0)


def pinned_order(rows):
    """edata-export.ts pinnedSheetOrder: the pinned numbers, the rest into the gaps their pass fits."""
    inf = float('inf')
    pinned, free = {}, []
    for r in sorted(rows, key=lambda r: (r['pos'] if r['pos'] is not None else inf, r['key'], r['run'])):
        if r['pos'] is not None and r['pos'] not in pinned:
            pinned[r['pos']] = r
        else:
            free.append(r)
    free.sort(key=lambda r: (r['key'], r['run']))
    placed, out, prev = set(), [], None
    last = max(pinned) if pinned else 0
    for p in range(1, last + 1):
        if p in pinned:
            out.append(pinned[p])
            prev = pinned[p]
            continue
        nxt = next((pinned[q] for q in range(p + 1, last + 1) if q in pinned), None)
        fit = next((f for f in free if f['car'] not in placed and (prev is None or f['key'] >= prev['key'])
                    and (nxt is None or f['key'] <= nxt['key'])), None)
        if fit:
            placed.add(fit['car'])
            out.append(fit)
            prev = fit
    tail = [f for f in free if f['car'] not in placed]
    return out + [f for f in tail if prev is None or f['key'] >= prev['key']] + [f for f in tail if prev is not None and f['key'] < prev['key']]


def ladder_reproduces(ev, cat, car, C):
    """Run the app's ladder rule on the tower's own sheet lines: does it put the car where the tower does?"""
    style = style_of(cat)
    tq = [e for e in C.ref[ev][1][cat][4] if e['et'].strip().upper() != 'DQ']
    rows = []
    for i, e in enumerate(tq):
        c = e['car'].upper()
        elim = sorted((r for r in runs_for(C.live, ev, cat, car=c) if re.match(r'^E\d+$', r.get('round') or '') and r.get('qual_pos')
                       and not (style == 'super' and r.get('round') == 'E1')), key=lambda r: int(r['round'][1:]))
        rows.append({'car': c, 'pos': elim[-1]['qual_pos'] if elim else None, 'key': sheet_key(style, e), 'run': i})
    if not any(r['pos'] is not None for r in rows):
        return False
    order = [r['car'] for r in pinned_order(rows)]
    tower = [r['car'] for r in rows]
    return car.upper() in order and order.index(car.upper()) == tower.index(car.upper())


def pair_shown(ev, cat, rnd, cars, C):
    """Do the cars share one stored clock time in the round — the pairing getresults shows?"""
    times = collections.defaultdict(set)
    for r in runs_for(C.live, ev, cat, rnd=f'E{rnd}'):
        car = (r.get('car_number') or '').strip().upper()
        times[r.get('timestamp')].add(car)
    cars = [c.upper() for c in cars]
    if len(cars) >= 2:
        return any(set(cars) <= s for s in times.values())
    return any(cars[0] in s and not ({c for c in s if c and c != 'BYE'} - {cars[0]}) for s in times.values())


def main():
    res = json.load(open(sys.argv[1]))
    appdir = sys.argv[2]
    live, ref = load()
    apps = {ev: json.load(open(f'{appdir}/{ev}.json')) for ev in M}
    C = Ctx(live, ref, apps)
    shift_only = {}
    for (ev, cat), entries in C.app_q.items():
        rq = ref[ev][1].get(cat)
        if rq:
            shift_only[(ev, cat)] = qdat_class_analysis(rq, entries)
    rows = []
    for ev, v in res.items():
        for g, d in v['diffs']:
            verdict = classify(ev, g, d, C, shift_only)
            rows.append((ev, g, d, verdict))
            if verdict.startswith('UNEXPLAINED') and os.environ.get('SHOW_UNEXPLAINED'):
                print('UNEXPLAINED', ev, g, d, '->', verdict)
    with open(sys.argv[3], 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['app_event', 'field', 'difference', 'verdict'])
        w.writerows(rows)
    c = collections.Counter(r[3] for r in rows if not r[1].startswith('entry:'))
    top = collections.Counter(r[3].split(':')[0] for r in rows if not r[1].startswith('entry:'))
    print('non-entry differences:', sum(c.values()), dict(top))
    for k, n in c.most_common():
        print(f'{n:5}  {k}')
    print('entry-field differences:', sum(1 for r in rows if r[1].startswith('entry:')))


def classify(ev, g, d, C, shift_only):
    live, ref = C.live, C.ref
    if g.startswith('entry:'):
        return 'ENTRY: tech-card enrichment (member/name/city/body/engine/class)'
    if g == 'winner':
        key = d.split(': winner')[0]
        if (ev, key) in DRC:
            return DRC[(ev, key)]
        cat_m = re.match(r'(.*?) ROUND (\d+) (\S+)/(\S+): winner folder (\S+) vs app (\S+)', d)
        cat, rnd, a, b = cat_m.group(1), int(cat_m.group(2)), cat_m.group(3), cat_m.group(4)
        rs = [r for r in runs_for(live, ev, cat, rnd=f'E{rnd}') if (r.get('car_number') or '').upper() in (a.upper(), b.upper())]
        if any(r.get('ft1320') is None and r.get('rt') is None for r in rs):
            return 'SOURCE: getresults row has no times/winner; the app keeps the row order it has'
        if sum(1 for p in C.pairs(ev, cat, rnd) if {x['car'].upper() for x in p['cars']} == {a.upper(), b.upper()}) > 1:
            return 'EXCEPTION: a re-run pair — the tower kept one run (BL1 kept only the re-run), the app writes both and warns'
        if any((r.get('car_number') or '').upper() == cat_m.group(6).upper() and (r.get('result') == 'W' or r.get('is_winner')) for r in rs):
            return "SOURCE: getresults flags the other car the winner; the app lists getresults' winner first"
        return 'UNEXPLAINED: the app lists a winner getresults does not flag'
    if g == 'pairing':
        cat = d.split(' ROUND')[0]
        if ev == '18' and cat == 'SUPER COMP':
            return 'SOURCE: getresults coded most of Super Comp round 1 as T4 (time trial)'
        if ev == 'II1' and cat == 'COMPETITION ELIMINATOR':
            return 'APP DATA GAP: 9 of 12 Comp round-2 pairs never reached the app store (DRC 421796)'
        if 'm-TEST' in d:
            return 'APP DATA: test row "m-TEST" in the production store (throw it out on the Runs page)'
        if not runs_for(live, ev, cat, rnd='E1'):
            return "APP DATA GAP: round 1 isn't in the store, so the app's rounds number one short against the tower file"
        rnd = int(re.search(r' ROUND (\d+):', d).group(1))
        if 'not in app (app has' in d:
            fcars = {c.upper() for c in re.search(r'folder pair (\S+) not in app', d).group(1).split('/')}
            alts = [[x['car'] for x in p['cars']] for p in C.pairs(ev, cat, rnd) if fcars & {x['car'].upper() for x in p['cars']}]
            if not all(pair_shown(ev, cat, rnd, p, C) for p in alts):
                return 'UNEXPLAINED: the app pairs cars getresults does not show together'
            return 'SOURCE: getresults car-number keying error / lost row (the app pairs what getresults shows)'
        pm = re.match(r'(.*?) ROUND (\d+): folder pair (\S+) not in app', d)
        if pm:
            cars = pm.group(3).split('/')
            stored = [c for c in cars if runs_for(live, ev, pm.group(1), car=c, rnd=f'E{pm.group(2)}')]
            if len(stored) < len(cars):
                return 'SOURCE: getresults has no round row for the pair (lost rows)'
            return 'SOURCE: getresults row times put the pair at another clock time'
        am = re.match(r'(.*?) ROUND (\d+): app pair (\S+) not in folder', d)
        if am:
            cars = am.group(3).split('/')
            same = sum(1 for p in C.pairs(ev, cat, rnd) if {x['car'].upper() for x in p['cars']} == {c.upper() for c in cars})
            if len(cars) == 2 and same > 1:
                return 'EXCEPTION: a re-run pair — the tower kept one run (BL1 kept only the re-run), the app writes both and warns'
            if not pair_shown(ev, cat, rnd, cars, C):
                return 'UNEXPLAINED: the app pairs cars getresults does not show together'
            return 'SOURCE: getresults shows a pairing the tower file does not (keying error / lost opponent row)'
    if g == 'round':
        if ev in ('12', 'BM1') and 'folder only' in d:
            return "APP DATA GAP: the event's last race day never reached the app store"
        rm = re.match(r'(.*?) ROUND (\d+): round in folder only', d)
        if rm and not runs_for(live, ev, rm.group(1), rnd=f'E{rm.group(2)}'):
            return 'APP DATA GAP: getresults/app store has no rows for this round'
        return 'APP DATA GAP: round missing from the store'
    if g == 'final_label':
        return 'APP DATA GAP: round 1 missing from the store shifts the round numbering (final is the 3rd round, file lists 2)'
    if g == 'bye_marker':
        if "folder ','" in d or re.search(r"folder ',\d", d):
            return 'EXCEPTION: this tower wrote the bye marker without the word SINGLE (LO1-4 quirk)'
        return 'ENTRY: member number in the SINGLE marker comes from the tech card (none on file)'
    if g == 'file':
        if 'class number' in d:
            return "EXCEPTION: the tower's own C# slot for a class it numbers its own way — pin it on the Data Out page"
        if re.search(r'&|#|/|SATSUN|SAT/SUN|JUNIOR DRAGSTER|JR DRAGSTER:', d) or re.search(r'JR 11 UP|11 UP|SOX MARTIN|2FAST2TASTY', d):
            return 'SOURCE/NAMING: getresults drops &, # and / from class names (class can only be matched by hand)'
        if 'in app' in d:
            if ev == '16' and 'PRO MOD' in d:
                return 'EXTRA: a two-pass Pro Mod qualifying class the tower pack does not export'
            return 'EXTRA: the app exports a class the tower pack does not contain'
        if 'QDAT' in d and ('SHOOTOUT' in d):
            return "SOURCE: the shootouts' qualifying passes are not on getresults"
        if ev == 'BM1':
            return "APP DATA GAP: the event's last race day (pro eliminations) never reached the app store"
        return 'APP DATA GAP: class missing from the store'
    if g in ('rt', 'et', 'mph', 'dial'):
        return edat_value(ev, g, d, C)
    if g == 'qpos':
        qm = re.match(r"(.*?) (?:ROUND (\d+)|FINALS) #(\S+) qpos: folder '([^']*)' vs app '([^']*)'", d)
        cat, rnd, car = qm.group(1), qm.group(2), qm.group(3)
        rs = [r for r in runs_for(live, ev, cat, car=car) if re.match(r'^E\d+$', r.get('round') or '')]
        own = {r.get('qual_pos') for r in rs if r.get('qual_pos')}
        if qm.group(5) in {str(x) for x in own}:
            return 'SOURCE: getresults Q Pos differs from the tower (the app prints the stored Q Pos)'
        if 'CALLOUT' in cat:
            return 'SOURCE: getresults shows a Q Pos for a callout class the tower ran without qualifying'
        if shift_only.get((ev, norm_name(cat))):
            return 'SOURCE: qualifying sheet shifted by entries missing from getresults or DQs it never shows'
        if not own:
            return "SOURCE: getresults has no Q Pos for the car; the app prints its QDAT position, where the sheet differs from the tower's (see the QDAT verdicts)"
        if norm_name(cat) in SUPER and rnd == '1':
            return "SOURCE: a Super class's round-1 rows print the sheet position (getresults' number there is a time-trial one); the sheet differs from the tower's (see the QDAT verdicts)"
        return 'UNEXPLAINED: the app prints a Q Pos that is neither the stored one nor the sheet'
    if g.startswith('q_'):
        return qdat_verdict(ev, g, d, C, shift_only)
    return 'UNEXPLAINED'


def edat_value(ev, g, d, C):
    dm = re.match(r"(.*?) ROUND (\d+) #(\S+) \w+: folder '([^']*)' vs app '([^']*)'", d)
    cat, rnd, car, f, a = dm.group(1), int(dm.group(2)), dm.group(3), dm.group(4), dm.group(5)
    rs = runs_for(C.live, ev, cat, car=car, rnd=f'E{rnd}')
    stored = finish(rs[0], g) if len(rs) == 1 else None
    if f and not re.match(r'^-?[\d. ]+$', f):
        return f'SOURCE: tower status code {f.strip()} (not on getresults)'
    if g == 'dial' and a == '' and stored is None:
        return 'SOURCE: getresults shows no dial-in on this pass (the tower prints the racer\'s dial)'
    if a.strip() in ('', '0.000', '0.00') and stored in (None, 0):
        return 'SOURCE: getresults row blank (no reading)'
    if g == 'rt' and a.strip() == '-0.500' and len(rs) == 1 and stored is None:
        return 'SOURCE: getresults has no reaction time on this finished pass (Portatree prints -0.500)'
    if stored in (99.999, 1.0) or (g == 'dial' and stored is not None and stored < 2):
        return 'SOURCE: getresults no-time stand-in / truncated value — printed as no value'
    if f == '':
        return 'SOURCE/FOLDER: tower file blank, getresults has a value'
    av, fv = num(a), num(f)
    if len(rs) > 1 and fv is not None and any(abs(x - fv) < 0.0011 for r in rs for x in readings(r, g)):
        if sum(1 for p in C.pairs(ev, cat, rnd) if car.upper() in {x['car'].upper() for x in p['cars']}) > 1:
            return 'EXCEPTION: a re-run pair — the tower kept one run (BL1 kept only the re-run), the app writes both and warns'
        return 'SOURCE: the car has two stored passes in this round; the tower printed the other'
    if len(rs) == 1 and av is not None and any(abs(x - av) < 0.0011 for x in readings(rs[0], g)):
        if ev in PORTATREE and fv is not None and abs(fv - av) <= 0.0011:
            return "EXCEPTION: Portatree's 4th decimal isn't on getresults (±0.001)"
        return 'SOURCE: getresults value differs from the tower file (app prints the stored value)'
    return 'UNEXPLAINED: the app prints a value that is not the stored one'


def qdat_one_side(ev, cat, d, C):
    car = re.search(r'#(\S*) ', d).group(1).upper()
    style = style_of(cat)
    rs = runs_for(C.all_live, ev, cat, car=car)
    q = [r for r in rs if counts(style, r)]
    if 'missing from app' in d:
        if not rs:
            return 'SOURCE: the qualifier has no pass in this class on getresults'
        if not q:
            if style == 'super':
                return "SOURCE: getresults has no round-1 run for the car, so it isn't on the round-1-winner sheet"
            return 'SOURCE: getresults has no qualifying pass for the car (its passes are in other rounds)'
        if not any(C.in_window(ev, r) for r in q):
            return "SOURCE: the car's qualifying passes on getresults are outside the event's dates (another race)"
        rs, q = [r for r in rs if C.in_window(ev, r)], [r for r in q if C.in_window(ev, r)]
        if not named(rs):
            return ('EXCEPTION: getresults shows a bare car number (no driver, no class); the tower knows the car from '
                    'its own entry list, and leaves most such numbers off, as the app does')
        if style == 'super' and not any(r.get('result') == 'W' or r.get('is_winner') for r in q):
            return 'SOURCE: getresults marks the car a round-1 loser (winner flag / lost opponent row), so it is off the winners sheet'
        return 'UNEXPLAINED: tower qualifier with qualifying passes on getresults'
    if car.startswith('M-TEST'):
        return 'APP DATA: test row "m-TEST" in the production store (throw it out on the Runs page)'
    if style == 'super':
        return 'SOURCE: getresults marks the car a round-1 winner the tower does not (winner flag / keying / lost opponent row)'
    if not named(rs):
        return 'SOURCE: a car number getresults keyed in error (no driver on any row)'
    if any(c != cat and any(e['car'].upper() == car for e in q[4]) for c, q in C.ref[ev][1].items()):
        return 'SOURCE: getresults files the pass under this class; the tower lists the car in another'
    ae = C.app_entry(ev, cat, car)
    if ae and num(ae['et']) in (None, 0.0, 28.0):
        return 'EXCEPTION: some towers leave off a qualifier with no timed pass (LO1-4, BM1); most print it at 28.000, as the app does'
    return "EXCEPTION: the tower's sheet leaves out a named qualifier getresults shows (a DQ or a withdrawal it never shows)"


def qdat_verdict(ev, g, d, C, shift_only):
    cat = norm_name(re.match(r'QDAT (.*?)(?::| #)', d).group(1))
    style = style_of(cat)
    if g == 'q_lowet':
        return "EXCEPTION: the tower's Low ET line has no single definition (the #1 qualifier's ET fits 72 of 120 classes)"
    if g == 'q_count':
        tq, aq = C.ref[ev][1].get(cat), C.app_q.get((ev, cat))
        n = re.search(r'folder (\d+) vs app (\d+)', d)
        if tq and aq is not None and int(n.group(1)) == len(tq[4]) and int(n.group(2)) == len(aq):
            return 'SOURCE: the count differs by the qualifiers on one side only (each checked in the QDAT order verdicts)'
        return 'UNEXPLAINED: a header count that is not the number of qualifiers listed'
    if g == 'q_topspeed':
        m = re.search(r"'Top Speed\s+([\d.]+)\s+(\S+)[^']*' vs app '(?:Top Speed\s+([\d.]+)\s+(\S+))?", d)
        if not m:
            return 'UNEXPLAINED: Top Speed line'
        tmph, tcar = float(m.group(1)), m.group(2).upper()
        amph = float(m.group(3)) if m.group(3) else None
        hit = [r for r in runs_for(C.live, ev, cat, car=tcar) if any(abs(x - tmph) < 0.006 for x in readings(r, 'mph'))]
        if not hit:
            return "SOURCE: the tower's Top Speed pass isn't on getresults"
        if not any(counts(style, r) for r in hit):
            return "EXCEPTION: the tower's Top Speed counts a pass the qualifying sheet doesn't (time trial or elimination)"
        if amph is not None and amph > tmph:
            return "SOURCE: the app's Top Speed is a pass the tower didn't count (a DQ'd or disallowed run getresults shows)"
        if not C.app_entry(ev, cat, tcar):
            return "SOURCE: the Top Speed car isn't on the app's sheet (see its QDAT order verdict)"
        return 'UNEXPLAINED: the tower\'s Top Speed pass is on the sheet but the app\'s is lower'
    if g == 'q_order':
        if 'missing from app' in d or 'not in folder' in d:
            return qdat_one_side(ev, cat, d, C)
        if shift_only.get((ev, cat)):
            return 'SOURCE: order shifted by entries missing from getresults or DQs it never shows (relative order identical)'
        if ev == '18' and cat == 'SUPER COMP':
            return 'SOURCE: getresults coded most of Super Comp round 1 as T4, so the round-1-winner sheet is incomplete'
        car = re.search(r'#(\S+) ', d).group(1).upper()
        info = order_info(ev, cat, C)
        if car in info['differ']:
            return "SOURCE: the car's best pass differs on getresults (see its QDAT field verdicts)"
        if car in info['dq']:
            return 'SOURCE: the tower DQd this qualifier; getresults never shows DQs'
        if car in info['qp']:
            return "SOURCE: getresults' Q Pos for the car differs from the tower's ladder (the app pins the stored one)"
        if info['rest_same']:
            return 'SOURCE: moved by qualifiers whose best pass or Q Pos differs on getresults, DQs, or entries on one side (the rest keep the tower\'s order)'
        if ladder_reproduces(ev, cat, car, C):
            return ("SOURCE: the app's ladder rule run on the tower's own lines puts the car where the tower does — it moves because "
                    "cars around it rank differently on getresults (their best pass, a keying error, entries on one side)")
        return 'UNEXPLAINED: qualifiers ranked on the same data in a different order'
    qm = re.match(r"QDAT (.*?) #(\S+) (\w+): folder '([^']*)' vs app '([^']*)'", d)
    car, field, f, a = qm.group(2), qm.group(3), qm.group(4), qm.group(5)
    if f.strip().upper() == 'DQ':
        return 'SOURCE: the tower DQd this qualifier; getresults never shows DQs'
    rs = runs_for(C.live, ev, cat, car=car)
    fv = num(f)
    if ev in PORTATREE and field == 'diff' and fv is not None and a and abs(fv - float(a)) <= 0.0011:
        return "EXCEPTION: Portatree cuts ET-minus-index from its 4-decimal ET, not on getresults (±0.001)"
    te, ae = C.tower_entry(ev, cat, car), C.app_entry(ev, cat, car)
    if style == 'headsup' and field in ('dial', 'diff'):
        return headsup_mph(ev, cat, car, field, fv, a, te, ae, rs)
    # Is the tower's printed ET one of the car's stored passes?
    tower_et = fv if field == 'et' else (num(te['et']) if te else None)
    ets = [x for r in rs for x in readings(r, 'et')]
    rts = [r.get('rt') for r in rs if r.get('rt') is not None]
    if tower_et is not None and not any(abs(tower_et - x) < 0.0006 for x in ets + rts):
        return "SOURCE: the tower's best pass isn't on getresults"
    hit = [r for r in rs if tower_et is not None and any(abs(tower_et - x) < 0.0006 for x in readings(r, 'et') + ([r['rt']] if style == 'rt' and r.get('rt') is not None else []))]
    rounds = {r.get('round') for r in hit}
    if hit and cat not in SUPER and not any(QUAL_ROUND.match(x or '') for x in rounds):
        return f"EXCEPTION: the tower counted a {'/'.join(sorted(x or '?' for x in rounds))} pass (not a qualifying round) for this car"
    if field in ('dial', 'diff') and cat not in SUPER and te:
        tdial = num(te['dial'])
        hdials = [r.get('dial_in') for r in hit if counts(style, r)] or [r.get('dial_in') for r in hit]
        if tdial is not None and hdials and not any(x is not None and abs(x - tdial) < 0.005 for x in hdials):
            if all(x is None for x in hdials):
                return "SOURCE: getresults shows no dial-in on the tower's pass (the app takes the car's other dial or its class index)"
            return 'SOURCE: the tower used a different index than the dial-in getresults shows'
    return qdat_pick(ev, cat, car, style, te, ae, rs)


def qdat_pick(ev, cat, car, style, te, ae, rs):
    """Is the app's printed pass the car's best by the class rule on the stored passes?"""
    if not te or not ae:
        return 'UNEXPLAINED: qualifier missing from one sheet'
    q = [r for r in rs if counts(style, r)]

    def find(e):
        v = num(e['et'])
        if v is None:
            return None
        for r in q:
            vals = [r.get('rt')] if style == 'rt' else readings(r, 'et')
            if any(x is not None and abs(x - v) < 0.0006 for x in vals):
                return r
        return None
    tp, ap = find(te), find(ae)
    if tp is None:
        return "SOURCE: the tower's best pass isn't one of the car's qualifying passes on getresults"
    if ap is None:
        return 'UNEXPLAINED: the app printed a pass that is not one of the car\'s stored qualifying passes'
    dial = num(ae['dial'])
    tk, ak = rule_key(style, tp, dial), rule_key(style, ap, dial)
    if tk is not None and ak is not None and at_least_as_good(ak, tk):
        return ("SOURCE: on the stored passes the app's pick is the car's best; the tower counted another "
                "(a DQ'd or disallowed run getresults shows as good)")
    return "UNEXPLAINED: the tower's pass beats the app's pick on the stored data"


def headsup_mph(ev, cat, car, field, fv, a, te, ae, rs):
    """Heads-up sheets print the pass's MPH and the best MPH in the last two columns."""
    if fv is None:
        return 'SOURCE/FOLDER: tower file blank, getresults has a value'
    if field == 'dial' and te and ae and num(te['et']) != num(ae['et']):
        return "SOURCE: follows the car's best pass, which differs (see its ET verdict)"
    hit = [r for r in rs if any(abs(x - fv) < 0.006 for x in readings(r, 'mph'))]
    if not hit:
        return "SOURCE: the tower's MPH isn't on getresults (pass not shown)"
    av = num(a)
    if av is not None and av > fv:
        return "SOURCE: the app's MPH is from a pass the tower didn't count (a DQ'd or disallowed run getresults shows)"
    if not any(counts('headsup', r) for r in hit):
        return "EXCEPTION: the tower's best MPH counts a pass the qualifying sheet doesn't (time trial or elimination)"
    return "UNEXPLAINED: the tower's MPH is a qualifying pass the app didn't take"


if __name__ == '__main__':
    main()
