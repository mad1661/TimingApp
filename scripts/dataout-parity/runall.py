"""Field-by-field comparison of every event's export with its tower pack.

python3 scripts/dataout-parity/runall.py <app dir from replay.ts> <results.json>
(then summary.py / diffs.py / classify2.py read the results file).
"""
import glob,json,collections,sys,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from cmp import compare_event
from paths import ROOT, EVENT_PACKS as M
appdir=sys.argv[1]; outp=sys.argv[2]
out={}
for ec,pre in M.items():
    rd=glob.glob(ROOT+'/flat/'+pre+'-*')[0]
    T,w=compare_event(rd,'%s/%s.json'%(appdir,ec))
    out[ec]={'ref':rd,'c':dict(T.c),'m':dict(T.m),'diffs':T.diffs,'warnings':w}
    core=[g for g in T.c if not g.startswith('entry:')]
    print(ec,pre,' '.join(f'{g}={T.m[g]}/{T.c[g]}' for g in sorted(core)))
json.dump(out,open(outp,'w'),indent=1)
