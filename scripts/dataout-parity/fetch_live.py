"""Read-only snapshot of the production data the Data Out export reads.

GET /api/runs (visible, AM/PM-tagged runs: exactly getTaggedRunsForEvent),
GET /api/tech-cards?all=1, GET /api/stats?type=qualifying-config, and the
production export itself (POST /api/dataout-export with pdfs:false, which only
reads) so the offline replay can be checked against what production returns.
Nothing here writes.
"""
import json, os, sys, time, urllib.request

BASE = 'https://timingapp--nhra-timing-app.us-east4.hosted.app'
SEASON = '2026'
from paths import ROOT, EVENT_PACKS
OUT = os.path.join(ROOT, 'live')


def get(path, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(BASE + path, timeout=120) as r:
                return json.loads(r.read().decode('utf-8'))
        except Exception as e:  # network blip: back off and retry
            if i == tries - 1:
                raise
            time.sleep(4 * 2 ** i)


def post(path, body, tries=4):
    data = json.dumps(body).encode('utf-8')
    for i in range(tries):
        try:
            req = urllib.request.Request(BASE + path, data=data, headers={'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.loads(r.read().decode('utf-8'))
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(4 * 2 ** i)


def runs_for(ev):
    runs, offset, total = [], 0, None
    while True:
        d = get(f'/api/runs?event_code={ev}&season={SEASON}&limit=1000&offset={offset}&sort_by=_dedup_key&sort_dir=ASC')
        total = d['total']
        runs.extend(d['runs'])
        offset += len(d['runs'])
        if not d['runs'] or offset >= total:
            break
    keys = [r.get('_dedup_key') for r in runs]
    assert len(runs) == total, (ev, len(runs), total)
    assert len(set(keys)) == len(keys), (ev, 'duplicate keys across pages')
    return runs


def main():
    os.makedirs(OUT, exist_ok=True)
    which = sys.argv[1:] or list(EVENT_PACKS)
    json.dump(get('/api/runs'), open(os.path.join(OUT, 'events.json'), 'w'))
    if not os.path.exists(os.path.join(OUT, 'techcards.json')) or 'tech' in which:
        tc = get('/api/tech-cards?all=1')['results']
        json.dump(tc, open(os.path.join(OUT, 'techcards.json'), 'w'))
        print('tech cards', len(tc))
    for ev in which:
        if ev == 'tech':
            continue
        runs = runs_for(ev)
        cfg = get(f'/api/stats?type=qualifying-config&event_code={ev}&season={SEASON}').get('config')
        prod = post('/api/dataout-export', {'event_code': ev, 'season': SEASON, 'pdfs': False})
        json.dump({'event_code': ev, 'season': SEASON, 'runs': runs, 'qualifying_config': cfg},
                  open(os.path.join(OUT, f'{ev}.json'), 'w'))
        json.dump(prod, open(os.path.join(OUT, f'{ev}.prod.json'), 'w'))
        print(ev, 'runs', len(runs), 'prod edat', len(prod.get('edat', [])), 'qdat', len(prod.get('qdat', [])))


if __name__ == '__main__':
    main()
