"""Flatten tower RACEDATA zips into $ROOT/flat/<zip name>/ (drops __MACOSX, ._*, .DS_Store).

python3 scripts/dataout-parity/unpack_refs.py <folder with the .zip packs, searched recursively>
"""
import glob, os, sys, zipfile
from paths import ROOT

src = sys.argv[1]
for z in sorted(glob.glob(os.path.join(src, '**', '*.[zZ][iI][pP]'), recursive=True)):
    name = os.path.splitext(os.path.basename(z))[0]
    out = os.path.join(ROOT, 'flat', name)
    os.makedirs(out, exist_ok=True)
    with zipfile.ZipFile(z) as zf:
        for info in zf.infolist():
            base = os.path.basename(info.filename)
            if info.is_dir() or '__MACOSX' in info.filename or base.startswith('._') or base == '.DS_Store' or not base:
                continue
            with zf.open(info) as f, open(os.path.join(out, base), 'wb') as g:
                g.write(f.read())
    print(name)
