"""Download only BCIT Burnaby plans; extract evidence, never infer walkable edges.

Usage: python scripts/prepare_maps.py [--refresh] [--extract-only]
Requires pdfplumber (see requirements-data.txt). URLs are discovered, not generated.
"""
import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path
import re
import subprocess
import shutil
import tempfile
import csv
import io
from datetime import datetime, timezone
import pdfplumber

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data/campus'
INDEX = 'https://www.bcit.ca/facilities/campus-maps/floor-plans/'
ATTRIBUTION = '© British Columbia Institute of Technology'


def save_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def download(url, path, refresh=False):
    if refresh or not path.exists():
        temp = path.with_suffix(path.suffix + '.part')
        subprocess.run(['curl', '-fLsS', '--retry', '2', '--max-time', '60',
                        url, '-o', str(temp)], check=True)
        if path.suffix == '.pdf' and not temp.read_bytes().startswith(b'%PDF'):
            temp.unlink()
            raise ValueError(f'Not a PDF: {url}')
        temp.replace(path)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh', action='store_true')
    parser.add_argument('--extract-only', action='store_true')
    args = parser.parse_args()
    for folder in ['raw', 'text']:
        (DATA / folder).mkdir(parents=True, exist_ok=True)
    old = json.loads((DATA / 'manifest.json').read_text()) if (DATA / 'manifest.json').exists() else {}
    retrieved = datetime.now(timezone.utc).isoformat()
    if args.extract_only:
        entries = old['sources']
    else:
        index_path = DATA / 'floor-plans-source.html'
        download(INDEX, index_path, args.refresh)
        html = index_path.read_text()
        urls = sorted(set(re.findall(r'https://www\.bcit\.ca/[^\"\s<>]*?/floorplans/(?:ne|nw|se|sw)/b(?:ne|nw|se|sw)\d{4}\.pdf', html)))
        if not urls:
            raise ValueError('Burnaby PDF links were not found. Inspect the source page; do not guess URLs.')
        def collect(url):
            filename = url.rsplit('/', 1)[1]
            match = re.fullmatch(r'b(ne|nw|se|sw)(\d{2})(\d{2})\.pdf', filename)
            building = match[1].upper() + str(int(match[2]))
            floor = str(int(match[3]))
            path = DATA / 'raw' / filename
            digest = download(url, path, args.refresh)
            prior = next((e for e in old.get('sources', []) if e['url'] == url and e['sha256'] == digest), None)
            return {'id': f'{building}-F{floor}', 'kind': 'floor-plan', 'campus': 'Burnaby',
                    'building': building, 'floor': floor, 'url': url, 'indexUrl': INDEX,
                    'retrievedAt': prior['retrievedAt'] if prior and not args.refresh else retrieved,
                    'sha256': digest, 'file': str(path.relative_to(ROOT)),
                    'attribution': ATTRIBUTION, 'verification': 'official-source; topology-unreviewed'}
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            entries = list(pool.map(collect, urls))
        map_url = 'https://www.bcit.ca/files/maps/pdf/bcit_wayfinding.pdf'
        path = DATA / 'raw/bcit_wayfinding.pdf'
        entries.append({'id': 'burnaby-wayfinding', 'kind': 'campus-map', 'campus': 'Burnaby',
                        'url': map_url, 'indexUrl': 'https://www.bcit.ca/facilities/campus-maps/',
                        'retrievedAt': retrieved, 'sha256': download(map_url, path, args.refresh),
                        'file': str(path.relative_to(ROOT)), 'attribution': ATTRIBUTION,
                        'verification': 'official-source; topology-unreviewed'})
        save_json(DATA / 'manifest.json', {'schemaVersion': 1, 'campus': 'Burnaby',
            'indexUrl': INDEX, 'indexSha256': hashlib.sha256(index_path.read_bytes()).hexdigest(),
            'retrievedAt': retrieved, 'attribution': ATTRIBUTION,
            'usage': {'url': 'https://www.bcit.ca/copyright/',
                'summary': 'Informational, non-commercial use; include copyright notice; keep source copies unmodified; authorization may be revoked. Other uses require permission. Derived records are separate research annotations, not altered BCIT plans.',
                'accuracy': 'BCIT provides floor plans for general information and does not warrant accuracy or completeness.'},
            'sources': entries})
    records = []
    for entry in entries:
        source_path = ROOT / entry['file']
        if hashlib.sha256(source_path.read_bytes()).hexdigest() != entry['sha256']:
            raise ValueError(f"Source hash mismatch: {entry['id']}")
        pages = []
        with pdfplumber.open(source_path) as pdf:
            for number, page in enumerate(pdf.pages, 1):
                words = page.extract_words()
                text = page.extract_text() or ''
                method = 'embedded-pdf-text'
                if not text.strip() and shutil.which('tesseract'):
                    method = 'local-tesseract-ocr; unreviewed'
                    with tempfile.TemporaryDirectory() as temp_dir:
                        image_path = Path(temp_dir) / 'page.png'
                        image = page.to_image(resolution=150).original
                        image.save(image_path)
                        result = subprocess.run(['tesseract', str(image_path), 'stdout', '-l', 'eng', '--psm', '11', 'tsv'], capture_output=True, text=True, check=True, timeout=60)
                        scale_x, scale_y = float(page.width) / image.width, float(page.height) / image.height
                        words = []
                        for row in csv.DictReader(io.StringIO(result.stdout), delimiter='\t'):
                            if not row.get('text', '').strip() or float(row.get('conf', '-1')) < 45:
                                continue
                            x, y, w, h = (float(row[k]) for k in ['left', 'top', 'width', 'height'])
                            words.append({'text': row['text'], 'x0': x * scale_x, 'top': y * scale_y,
                                          'x1': (x + w) * scale_x, 'bottom': (y + h) * scale_y})
                        text = ' '.join(word['text'] for word in words)
                elif not text.strip():
                    method = 'no-embedded-text; install-tesseract-for-ocr'
                labels = [{'text': w['text'], 'bbox': [round(w[k], 2) for k in ['x0','top','x1','bottom']],
                           'sourceRef': f"{entry['id']}#page={number}", 'reviewStatus': 'unreviewed-extraction'}
                          for w in words if re.fullmatch(r'[A-Z]?\d{3,4}[A-Z]?', w['text'])]
                pages.append({'page': number, 'width': float(page.width), 'height': float(page.height), 'textMethod': method,
                              'coordinateSystem': 'PDF points; top-left origin; not geographic; no inferred scale',
                              'text': text, 'labelCandidates': labels})
        save_json(DATA / 'text' / f"{entry['id']}.json", {'sourceId': entry['id'], 'pages': pages})
        records.append({'id': entry['id'], 'kind': entry['kind'], 'building': entry.get('building'),
                        'floor': entry.get('floor'), 'title': f"{entry['building']} · Floor {entry['floor']}" if entry.get('building') else 'Burnaby campus wayfinding map',
                        'url': entry['url'], 'localUrl': '/' + entry['file'], 'attribution': ATTRIBUTION,
                        'sourceRef': entry['id'], 'text': '\n'.join(p['text'] for p in pages),
                        'labelCount': sum(len(p['labelCandidates']) for p in pages),
                        'textMethods': sorted({p['textMethod'] for p in pages}), 'routingSupported': False})
    save_json(DATA / 'catalogue.json', records)
    buildings = sorted({r['building'] for r in records if r['building']})
    save_json(DATA / 'coverage.json', {'campus': 'Burnaby', 'buildings': buildings,
        'floorPlans': len(records) - 1, 'extractedLabelCandidates': sum(r['labelCount'] for r in records),
        'routingVerified': False, 'supportedRealRoutingNodes': 0,
        'unsupported': 'All campus routes, entrances, transitions, distances, floor alignment, accessibility, live conditions, and camera localization require review. CARI and other campuses excluded.',
        'floors': [{'building': b, 'floors': [r['floor'] for r in records if r['building'] == b]} for b in buildings]})
    print(f'Prepared {len(records) - 1} Burnaby floor plans, {len(buildings)} buildings, and one official campus map.')


if __name__ == '__main__':
    main()
