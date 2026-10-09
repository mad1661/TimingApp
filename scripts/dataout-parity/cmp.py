"""Comparator from the 2026-10-09 tiebreaker-folder audit, unchanged: parses the
tower's and the app's EDAT/QDAT and tallies every field (compare_event)."""
import json, os, re, glob, sys, collections

def read(p):
    b=open(p,'rb').read().split(b'\x1a')[0]
    return b.decode('latin1').replace('\r','')

def norm_name(s): return re.sub(r'\s+',' ',(s or '').strip().upper())

def fnum(s):
    s=(s or '').replace(' ','').strip()
    if s in ('',): return None
    try: return round(float(s),3)
    except: return s.upper()

EDF=['car','member','cls','qpos','name','city','body','engine','rt','dial','et','mph']
CORE_E=['rt','dial','et','mph','qpos']
ENTRY_E=['member','name','city','body','engine','cls']

def parse_edat(txt):
    lines=[l for l in txt.split('\n')]
    cat=None; rounds=collections.OrderedDict(); cur=None; rows=[]
    m=re.match(r'(?:Compulink StarTrak|Portatree|\S+ StarTrak)\s+(.*?) Elimination Results',lines[0].strip()) if lines else None
    cat=m.group(1).strip() if m else lines[0].strip()
    def flush():
        if cur is None: return
        pairs=[]; i=0
        while i<len(rows):
            r=rows[i]
            if r['marker']: i+=1; continue
            if i+1<len(rows) and rows[i+1]['marker']:
                pairs.append({'cars':[r],'single':True,'marker_raw':rows[i+1]['raw']}); i+=2
            elif i+1<len(rows):
                pairs.append({'cars':[r,rows[i+1]],'single':False}); i+=2
            else:
                pairs.append({'cars':[r],'single':True,'marker_raw':None}); i+=1
        rounds[cur]=pairs
    for l in lines[1:]:
        s=l.strip()
        if not s: continue
        if s.startswith('End of File'): break
        if re.match(r'^(ROUND \d+|FINALS)$',s):
            flush(); cur=s; rows=[]; continue
        f=l.split(',')
        if len(f)>12:  # comma inside a field: merge extras into name/city area conservatively
            f=f[:6]+[','.join(f[6:len(f)-5])]+f[len(f)-5:]
        f+=['']*(12-len(f))
        d=dict(zip(EDF,[x.strip() for x in f[:12]]))
        d['raw']=l
        d['marker']= (d['car'].upper()=='SINGLE' or d['car']=='')
        rows.append(d)
    flush()
    return cat, rounds

QF=['car','member','cls','body','year','engine','x1','x2','name','city','et','dial','diff']
def parse_qdat(txt):
    lines=[l for l in txt.split('\n')]
    m=re.match(r'(?:Compulink StarTrak|Portatree|\S+ StarTrak)\s+(.*?) Qualifying for (\d+) entries',lines[0].strip())
    cat=m.group(1).strip() if m else lines[0].strip(); n=int(m.group(2)) if m else None
    lowet=top=None; ents=[]
    for l in lines[1:]:
        s=l.strip()
        if not s: continue
        if s.startswith('End of File'): break
        if s.startswith('Low ET'): lowet=s; continue
        if s.startswith('Top Speed'): top=s; continue
        f=l.split(',')
        if len(f)>13: f=f[:8]+[f[8]]+[','.join(f[9:len(f)-3])]+f[len(f)-3:]
        f+=['']*(13-len(f))
        ents.append(dict(zip(QF,[x.strip() for x in f[:13]])))
    return cat,n,lowet,top,ents

def cmpval(k,a,b):
    if k in ('rt','dial','et','mph','diff'): return fnum(a)==fnum(b)
    if k in ('name','city','body','engine','cls'): return norm_name(a)==norm_name(b)
    if k=='qpos' or k=='member': return (a or '').strip().lstrip('0')==(b or '').strip().lstrip('0')
    return (a or '').strip()==(b or '').strip()

class Tally:
    def __init__(s): s.c=collections.Counter(); s.m=collections.Counter(); s.diffs=[]
    def add(s,group,ok,desc=None):
        s.c[group]+=1
        if ok: s.m[group]+=1
        elif desc: s.diffs.append((group,desc))

def compare_event(refdir, appjson):
    T=Tally()
    app=json.load(open(appjson))
    ref_e={}; ref_q={}
    for p in glob.glob(os.path.join(refdir,'*')):
        b=os.path.basename(p).upper()
        if re.match(r'^C\d+EDAT\.TXT$',b): c,r=parse_edat(read(p)); ref_e[norm_name(c)]=(b,c,r)
        elif re.match(r'^C\d+QDAT\.TXT$',b): ref_q[norm_name(parse_qdat(read(p))[0])]=(b,parse_qdat(read(p)))
    app_e={}; app_q={}
    for f in app.get('edat',[]):
        c,r=parse_edat(f['content']); app_e[norm_name(c)]=(f['filename'],c,r)
    for f in app.get('qdat',[]):
        q=parse_qdat(f['content']); app_q[norm_name(q[0])]=(f['filename'],q)
    classes=[]
    # EDAT
    for cat in sorted(set(ref_e)|set(app_e)):
        if cat not in ref_e:
            T.add('file',False,f'EDAT {cat}: in app ({app_e[cat][0]}) but not in folder'); continue
        if cat not in app_e:
            T.add('file',False,f'EDAT {cat}: in folder ({ref_e[cat][0]}) but app produced no EDAT'); continue
        rf,_,rr0=ref_e[cat]; af,_,ar0=app_e[cat]
        def renum(rr):
            out=collections.OrderedDict(); labels={}
            for i,(k,v) in enumerate(rr.items()):
                n=k if k.startswith('ROUND') else f'ROUND {i+1}'
                out[n]=v; labels[n]=k
            return out,labels
        rr,rl=renum(rr0); ar,al=renum(ar0)
        for n in rr:
            if n in ar and (rl[n]=='FINALS')!=(al[n]=='FINALS'):
                T.add('final_label',False,f"{cat} {n}: folder labels it '{rl[n]}', app '{al[n]}'")
            elif n in ar: T.add('final_label',True)
        T.add('file',rf==af,f'EDAT {cat}: class number folder {rf} vs app {af}')
        for rnd in list(rr.keys())+[k for k in ar if k not in rr]:
            rp=rr.get(rnd); ap=ar.get(rnd)
            if rp is None: T.add('round',False,f'{cat} {rnd}: round in app only ({len(ap)} pairs)'); continue
            if ap is None: T.add('round',False,f'{cat} {rnd}: round in folder only ({len(rp)} pairs) — missing from app'); continue
            T.add('round',True)
            akey={}
            for p in ap: akey.setdefault(frozenset(c['car'].upper() for c in p['cars']),[]).append(p)
            used=collections.Counter()
            for p in rp:
                k=frozenset(c['car'].upper() for c in p['cars'])
                lst=akey.get(k) or []
                q=lst[used[k]] if used[k]<len(lst) else None
                cars='/'.join(c['car'] for c in p['cars'])
                if q is None:
                    alt=[x for x in ap if set(c['car'].upper() for c in x['cars'])&k]
                    T.add('pairing',False,f"{cat} {rnd}: folder pair {cars} not in app" + (f" (app has {'/'.join('/'.join(c['car'] for c in x['cars']) for x in alt)})" if alt else ''))
                    continue
                used[k]+=1
                T.add('pairing',True)
                T.add('winner',p['cars'][0]['car'].upper()==q['cars'][0]['car'].upper(),f"{cat} {rnd} {cars}: winner folder {p['cars'][0]['car']} vs app {q['cars'][0]['car']}")
                if p['single']:
                    mr=(p.get('marker_raw') or '').strip(); ma=(q.get('marker_raw') or '').strip()
                    T.add('bye_marker',mr.split(',')[:2]==ma.split(',')[:2],f"{cat} {rnd} single {cars}: bye marker folder '{mr}' vs app '{ma}'")
                qa={c['car'].upper():c for c in q['cars']}
                for c in p['cars']:
                    a=qa[c['car'].upper()]
                    for k2 in CORE_E:
                        T.add(k2,cmpval(k2,c[k2],a[k2]),f"{cat} {rnd} #{c['car']} {k2}: folder '{c[k2]}' vs app '{a[k2]}'")
                    for k2 in ENTRY_E:
                        T.add('entry:'+k2,cmpval(k2,c[k2],a[k2]),f"{cat} {rnd} #{c['car']} {k2}: folder '{c[k2]}' vs app '{a[k2]}'")
            for k,lst in akey.items():
                for p in lst[used[k]:]: T.add('pairing',False,f"{cat} {rnd}: app pair {'/'.join(c['car'] for c in p['cars'])} not in folder")
    # QDAT
    for cat in sorted(set(ref_q)|set(app_q)):
        if cat not in ref_q: T.add('file',False,f'QDAT {cat}: in app ({app_q[cat][0]}) but not in folder'); continue
        if cat not in app_q: T.add('file',False,f'QDAT {cat}: in folder ({ref_q[cat][0]}) but app produced no QDAT'); continue
        rf,(rc,rn,rl,rt,re_)=ref_q[cat]; af,(ac,an,al,at,ae)=app_q[cat]
        T.add('file',rf==af,f'QDAT {cat}: class number folder {rf} vs app {af}')
        T.add('q_count',rn==an,f'QDAT {cat}: entries header folder {rn} vs app {an}')
        T.add('q_lowet',(rl or '').split()[:4]==(al or '').split()[:4],f"QDAT {cat}: '{rl}' vs app '{al}'")
        T.add('q_topspeed',(rt or '').split()[:4]==(at or '').split()[:4],f"QDAT {cat}: '{rt}' vs app '{at}'")
        apos={e['car'].upper():(i,e) for i,e in enumerate(ae)}
        for i,e in enumerate(re_):
            x=apos.get(e['car'].upper())
            if x is None: T.add('q_order',False,f"QDAT {cat}: #{e['car']} {e['name']} (folder pos {i+1}) missing from app"); continue
            j,a=x
            T.add('q_order',i==j,f"QDAT {cat}: #{e['car']} {e['name']} position folder {i+1} vs app {j+1}")
            for k2 in ('et','dial','diff'):
                T.add('q_'+k2,cmpval(k2,e[k2],a[k2]),f"QDAT {cat} #{e['car']} {k2}: folder '{e[k2]}' vs app '{a[k2]}'")
            for k2 in ('member','name','city','body','engine','cls'):
                T.add('entry:q_'+k2,cmpval(k2,e[k2],a[k2]),f"QDAT {cat} #{e['car']} {k2}: folder '{e[k2]}' vs app '{a[k2]}'")
        rset={e['car'].upper() for e in re_}
        for e in ae:
            if e['car'].upper() not in rset: T.add('q_order',False,f"QDAT {cat}: app lists #{e['car']} {e['name']} not in folder")
    return T, app.get('warnings',[])

if __name__=='__main__':
    T,w=compare_event(sys.argv[1],sys.argv[2])
    for g in sorted(T.c): print(f'{g:18} {T.m[g]}/{T.c[g]}')
    for g,d in T.diffs: print(g,'|',d)
