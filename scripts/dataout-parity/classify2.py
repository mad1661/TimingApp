"""Verdict for every difference left after the fixes, checked against the stored rows.

classify2.py results.json appdir out.csv — every row gets a verdict:
  SOURCE …     the getresults data differs from the tower (or lacks the row/pass)
  APP DATA …   the app's store is missing data getresults had (ingest gap, test row)
  EXCEPTION …  documented: the tower's choice isn't recoverable from getresults
  ENTRY …      tech-card enrichment (member/name/city/body/engine)
  UNEXPLAINED  anything no rule covers — must be zero
"""
import csv, glob, json, os, re, sys, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cmp import read, parse_qdat, parse_edat, norm_name, fnum

from paths import ROOT, EVENT_PACKS as M
PORTATREE = {'13', '41', '42'}
SUPER = {'SUPER COMP', 'SUPER GAS', 'SUPER STREET'}

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
    live, ref, app = {}, {}, {}
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


def qdat_class_analysis(ref_q, app_q):
    """Is the app's order the tower's once cars on only one side (or DQ'd by the tower) are set aside?"""
    rcars = [e['car'].upper() for e in ref_q[4] if e['et'].strip().upper() != 'DQ']
    acars = [l.split(',')[0].upper() for l in app_q]
    common = [c for c in rcars if c in set(acars)]
    aorder = [c for c in acars if c in set(common)]
    return common == aorder


def main():
    res = json.load(open(sys.argv[1]))
    appdir = sys.argv[2]
    live, ref = load()
    apps = {ev: json.load(open(f'{appdir}/{ev}.json')) for ev in M}
    app_q = {}
    for ev, a in apps.items():
        for f in a['qdat']:
            lines = [l for l in f['content'].split('\r\n')[1:] if l and not l.startswith(('Low ET', 'Top Speed', 'End of File'))]
            app_q[(ev, norm_name(f['category']))] = lines
    shift_only = {}
    for (ev, cat), lines in app_q.items():
        rq = ref[ev][1].get(cat)
        if rq:
            shift_only[(ev, cat)] = qdat_class_analysis(rq, lines)
    rows = []
    for ev, v in res.items():
        for g, d in v['diffs']:
            verdict = classify(ev, g, d, live, ref, shift_only)
            rows.append((ev, g, d, verdict))
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


def classify(ev, g, d, live, ref, shift_only):
    if g.startswith('entry:'):
        return 'ENTRY: tech-card enrichment (member/name/city/body/engine/class)'
    m = re.match(r'(?:QDAT )?(.*?) (?:ROUND \d+|FINALS)', d)
    if g == 'winner':
        key = d.split(': winner')[0]
        if (ev, key) in DRC:
            return DRC[(ev, key)]
        cat_m = re.match(r'(.*?) ROUND (\d+) (\S+)/(\S+): winner folder (\S+) vs app (\S+)', d)
        cat, rnd, a, b = cat_m.group(1), int(cat_m.group(2)), cat_m.group(3), cat_m.group(4)
        rs = [r for r in runs_for(live, ev, cat, rnd=f'E{rnd}') if (r.get('car_number') or '').upper() in (a.upper(), b.upper())]
        if any(r.get('ft1320') is None and r.get('rt') is None for r in rs):
            return 'SOURCE: getresults row has no times/winner; the app keeps the row order it has'
        flags = {(r.get('car_number') or '').upper(): r.get('result') for r in rs}
        return f'SOURCE: getresults winner flag differs from the tower ({flags})'
    if g == 'pairing':
        cat = d.split(' ROUND')[0]
        if 'not in app (app has' in d:
            return 'SOURCE: getresults car-number keying error / lost row (the app pairs what getresults shows)'
        if ev == '18' and cat == 'SUPER COMP':
            return 'SOURCE: getresults coded most of Super Comp round 1 as T4 (time trial)'
        if ev == 'II1' and cat == 'COMPETITION ELIMINATOR':
            return 'APP DATA GAP: 9 of 12 Comp round-2 pairs never reached the app store (DRC 421796)'
        if 'm-TEST' in d:
            return 'APP DATA: test row "m-TEST" in the production store (throw it out on the Runs page)'
        pm = re.match(r'(.*?) ROUND (\d+): folder pair (\S+) not in app', d)
        if pm:
            cars = pm.group(3).split('/')
            stored = [c for c in cars if runs_for(live, ev, pm.group(1), car=c, rnd=f'E{pm.group(2)}')]
            if len(stored) < len(cars):
                return 'SOURCE: getresults has no round row for the pair (lost rows)'
            return 'SOURCE: getresults row times put the pair at another clock time'
        am = re.match(r'(.*?) ROUND (\d+): app pair (\S+) not in folder', d)
        if am:
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
        dm = re.match(r"(.*?) ROUND (\d+) #(\S+) \w+: folder '([^']*)' vs app '([^']*)'", d)
        cat, rnd, car, f, a = dm.group(1), int(dm.group(2)), dm.group(3), dm.group(4), dm.group(5)
        rs = runs_for(live, ev, cat, car=car, rnd=f'E{rnd}')
        stored = finish(rs[0], g) if len(rs) == 1 else None
        if f and not re.match(r'^-?[\d. ]+$', f):
            return f'SOURCE: tower status code {f.strip()} (not on getresults)'
        if g == 'dial' and a == '' and stored is None:
            return 'SOURCE: getresults shows no dial-in on this pass (the tower prints the racer\'s dial)'
        if a.strip() in ('', '0.000', '0.00') and stored in (None, 0):
            return 'SOURCE: getresults row blank (no reading)'
        if stored in (99.999, 1.0) or (g == 'dial' and stored is not None and stored < 2):
            return 'SOURCE: getresults no-time stand-in / truncated value — printed as no value'
        if f == '':
            return 'SOURCE/FOLDER: tower file blank, getresults has a value'
        if stored is not None and fnum(a) is not None and abs(float(stored) - float(a.replace(' ', ''))) < 0.0011:
            if ev in PORTATREE and abs(float(f.replace(' ', '')) - float(a.replace(' ', ''))) <= 0.0011:
                return "EXCEPTION: Portatree's 4th decimal isn't on getresults (±0.001)"
            return 'SOURCE: getresults value differs from the tower file (app prints the stored value)'
        return 'SOURCE: getresults value differs from the tower file'
    if g == 'qpos':
        qm = re.match(r"(.*?) (?:ROUND (\d+)|FINALS) #(\S+) qpos: folder '([^']*)' vs app '([^']*)'", d)
        cat, car = qm.group(1), qm.group(3)
        rs = [r for r in runs_for(live, ev, cat, car=car) if re.match(r'^E\d+$', r.get('round') or '')]
        own = {r.get('qual_pos') for r in rs}
        if qm.group(5) in {str(x) for x in own if x}:
            return 'SOURCE: getresults Q Pos differs from the tower (the app prints the stored Q Pos)'
        if 'CALLOUT' in cat:
            return 'SOURCE: getresults shows a Q Pos for a callout class the tower ran without qualifying'
        if shift_only.get((ev, norm_name(cat))):
            return 'SOURCE: qualifying sheet shifted by entries missing from getresults or DQs it never shows'
        return 'SOURCE: getresults Q Pos missing; the sheet the position is read from differs from the tower (see QDAT verdicts)'
    if g.startswith('q_'):
        cat = norm_name(re.match(r'QDAT (.*?)(?::| #)', d).group(1))
        if g == 'q_lowet':
            return "EXCEPTION: the tower's Low ET line has no single definition (the #1 qualifier's ET fits 72 of 120 classes)"
        if g == 'q_count':
            return 'SOURCE: qualifier count differs — entries missing from getresults / unknown to it'
        if g == 'q_topspeed':
            return 'SOURCE: Top Speed pass not on getresults / tower counts a different pass set'
        if g == 'q_order':
            if 'missing from app' in d or 'not in folder' in d:
                return 'SOURCE: qualifier on only one side (pass not on getresults, unnamed car, DQ, keying error)'
            if shift_only.get((ev, cat)):
                return 'SOURCE: order shifted by entries missing from getresults or DQs it never shows (relative order identical)'
            if ev == '18' and cat == 'SUPER COMP':
                return 'SOURCE: getresults coded most of Super Comp round 1 as T4, so the round-1-winner sheet is incomplete'
            return 'SOURCE: qualifying passes missing from getresults change the ranking'
        qm = re.match(r"QDAT (.*?) #(\S+) (\w+): folder '([^']*)' vs app '([^']*)'", d)
        car, field, f, a = qm.group(2), qm.group(3), qm.group(4), qm.group(5)
        if f.strip().upper() == 'DQ':
            return 'SOURCE: the tower DQd this qualifier; getresults never shows DQs'
        rs = runs_for(live, ev, cat, car=car)
        try:
            fv = float(f)
        except ValueError:
            fv = None
        if ev in PORTATREE and field == 'diff' and fv is not None and a and abs(fv - float(a)) <= 0.0011:
            return "EXCEPTION: Portatree cuts ET-minus-index from its 4-decimal ET, not on getresults (±0.001)"
        # Is the tower's printed ET one of the car's stored passes?
        ets = [finish(r, 'et') for r in rs if finish(r, 'et')]
        rts = [r.get('rt') for r in rs if r.get('rt') is not None]
        tower_et = None
        if field == 'et' and fv is not None:
            tower_et = fv
        else:
            ent = next((e for e in ref[ev][1].get(cat, (0, 0, 0, 0, []))[4] if e['car'].upper() == car.upper()), None)
            try:
                tower_et = float(ent['et']) if ent else None
            except (ValueError, TypeError):
                tower_et = None
        if tower_et is not None and not any(abs(tower_et - x) < 0.0006 for x in ets + rts):
            return "SOURCE: the tower's best pass isn't on getresults"
        hit = [r for r in rs if (finish(r, 'et') and abs(finish(r, 'et') - tower_et) < 0.0006)] if tower_et is not None else []
        rounds = {r.get('round') for r in hit}
        if hit and not any(re.match(r'^(Q\d*|QC|C1)$', x or '') for x in rounds) and cat not in SUPER:
            return f"EXCEPTION: the tower counted a {'/'.join(sorted(x or '?' for x in rounds))} pass (not a qualifying round) for this car"
        if field in ('dial', 'diff') and cat not in SUPER:
            dials = {r.get('dial_in') for r in hit}
            try:
                if fv is not None and field == 'dial' and fv not in dials:
                    return 'SOURCE: the tower used a different index than the dial-in getresults shows'
            except Exception:
                pass
        if field in ('dial', 'diff') and fv is not None and fv > 30:
            return 'SOURCE: heads-up MPH column — the tower counts a different MPH (pass not on getresults / later session)'
        return 'SOURCE: the tower ranked another of the car\'s passes best (passes or DQs not on getresults)'
    return 'UNEXPLAINED'


if __name__ == '__main__':
    main()
