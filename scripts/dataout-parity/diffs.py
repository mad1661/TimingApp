"""Browse remaining differences: diffs.py results.json [group-regex] [event] [limit]"""
import json, sys, re, collections
r = json.load(open(sys.argv[1]))
pat = re.compile(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2] else None
ev = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None
lim = int(sys.argv[4]) if len(sys.argv) > 4 else 60
if pat is None:
    c = collections.Counter()
    for e, v in r.items():
        for g, d in v['diffs']:
            if not g.startswith('entry:'):
                c[(g, e)] += 1
    tot = collections.Counter()
    for (g, e), n in c.items():
        tot[g] += n
    for g, n in tot.most_common():
        print(f'{g:14} {n:5}  ' + ' '.join(f'{e}:{c[(g, e)]}' for e in r if c[(g, e)]))
    sys.exit()
n = 0
for e, v in r.items():
    if ev and e != ev:
        continue
    for g, d in v['diffs']:
        if pat.search(g):
            print(e, g, '|', d)
            n += 1
            if n >= lim:
                sys.exit()
