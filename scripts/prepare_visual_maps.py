"""Build reproducible visual and geometric evidence from the downloaded BCIT PDFs.

No network or model calls. Source PDFs remain unmodified. Extracted drawing paths
are not asserted to be walls, doors, accessible passages, or routing topology.
Usage: python scripts/prepare_visual_maps.py [--workers 3]
"""
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
import argparse
import hashlib
import json
import math
import pdfplumber
from PIL import Image, ImageDraw, ImageFont
from PIL.PngImagePlugin import PngInfo

ROOT = Path(__file__).resolve().parents[1]
CAMPUS = ROOT / 'data/campus'
OUTPUT = CAMPUS / 'visual'
ATTRIBUTION = '© British Columbia Institute of Technology'
TILES = [('nw', [0, 0, .55, .55]), ('ne', [.45, 0, 1, .55]),
         ('sw', [0, .45, .55, 1]), ('se', [.45, .45, 1, 1])]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, content, compact=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(content, ensure_ascii=False, indent=None if compact else 2,
                               separators=(',', ':') if compact else None) + '\n')


def image_record(path, image):
    path.parent.mkdir(parents=True, exist_ok=True)
    metadata = PngInfo()
    metadata.add_text('Copyright', ATTRIBUTION)
    metadata.add_text('Source', 'https://www.bcit.ca/facilities/campus-maps/floor-plans/')
    metadata.add_text('Notice', 'Derived reference image; not a verified campus navigation map.')
    image.convert('RGB').save(path, format='PNG', optimize=True, pnginfo=metadata)
    return {'file': str(path.relative_to(ROOT)), 'url': '/' + str(path.relative_to(ROOT)),
            'width': image.width, 'height': image.height, 'sha256': digest(path)}


def resized(image, max_edge):
    copy = image.copy()
    copy.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
    return copy


def scalar(value):
    if isinstance(value, (int, float)):
        return round(float(value), 4)
    if isinstance(value, (list, tuple)):
        return [scalar(item) for item in value]
    return value


def process_source(source):
    path = ROOT / source['file']
    if digest(path) != source['sha256']:
        raise ValueError(f"Source hash mismatch: {source['id']}")
    evidence_path = CAMPUS / 'text' / f"{source['id']}.json"
    evidence = json.loads(evidence_path.read_text()) if evidence_path.exists() else {'pages': []}
    results = []
    with pdfplumber.open(path) as document:
        for number, page in enumerate(document.pages, 1):
            plan_id = f"{source['id']}-p{number}"
            width, height = float(page.width), float(page.height)
            # 180 dpi preserves drawing detail; AI receives bounded overviews/tiles.
            raster = page.to_image(resolution=180).original.convert('RGB')
            folder = OUTPUT / 'png' / plan_id
            full = image_record(folder / 'full.png', raster)
            overview = image_record(folder / 'overview.png', resized(raster, 1600))
            tile_records = []
            for tile_id, bounds in TILES:
                pixels = [round(bounds[0] * raster.width), round(bounds[1] * raster.height),
                          round(bounds[2] * raster.width), round(bounds[3] * raster.height)]
                tile = image_record(folder / f'{tile_id}.png', resized(raster.crop(pixels), 1200))
                tile_records.append({'id': tile_id, 'bounds': bounds, **tile})
            primitives = []
            segments = []
            for kind, items in [('line', page.lines), ('rectangle', page.rects), ('curve', page.curves)]:
                for index, item in enumerate(items):
                    primitive_id = f'{kind}-{index + 1}'
                    bounds = [item['x0'], item['top'], item['x1'], item['bottom']]
                    points = item.get('pts', [])
                    if kind == 'rectangle':
                        x0, y0, x1, y1 = bounds
                        points = [(x0,y0), (x1,y0), (x1,y1), (x0,y1), (x0,y0)]
                    primitive = {'id': primitive_id, 'kind': kind, 'bbox': scalar(bounds),
                        'points': scalar(points), 'strokeWidth': scalar(item.get('linewidth', 0)),
                        'strokeColor': scalar(item.get('stroking_color')),
                        'fillColor': scalar(item.get('non_stroking_color')),
                        'filled': bool(item.get('fill', False)), 'semanticClass': 'unclassified',
                        'sourceRef': f"{source['id']}#page={number}"}
                    if item.get('path'):
                        primitive['path'] = scalar(item['path'])
                    primitives.append(primitive)
                    # Long path segments are useful geometric evidence, not semantic wall labels.
                    for a, b in zip(points, points[1:]):
                        length = math.hypot(b[0]-a[0], b[1]-a[1])
                        if length < max(12, min(width,height)*.015):
                            continue
                        normalized = [a[0]/width, a[1]/height, b[0]/width, b[1]/height]
                        if any(v < -.002 or v > 1.002 for v in normalized):
                            continue
                        segments.append({'primitiveId': primitive_id,
                            'coordinates': [round(max(0,min(1,v)),5) for v in normalized],
                            'lengthPdfPoints': round(length,2), 'semanticClass': 'unclassified'})
            page_evidence = next((p for p in evidence['pages'] if p['page'] == number), {})
            labels = []
            for word in page.extract_words():
                labels.append({'text': word['text'], 'bbox': scalar([word['x0'],word['top'],word['x1'],word['bottom']]),
                               'method': 'embedded-pdf-text', 'verified': False})
            if not labels:
                labels = [{'text': item['text'], 'bbox': item['bbox'], 'method': 'local-ocr', 'verified': False}
                          for item in page_evidence.get('labelCandidates', [])]
            # Spatially distribute a bounded segment sample for model input.
            buckets = {}
            for segment in segments:
                x0,y0,x1,y1 = segment['coordinates']
                key = (min(3,int((x0+x1)*2)), min(3,int((y0+y1)*2)))
                buckets.setdefault(key, []).append(segment)
            for bucket in buckets.values():
                bucket.sort(key=lambda item: -item['lengthPdfPoints'])
            model_segments = []
            for rank in range(8):
                for key in sorted(buckets):
                    if rank < len(buckets[key]): model_segments.append(buckets[key][rank])
            geometry = {'schemaVersion': 1, 'id': plan_id, 'sourceId': source['id'],
                'sourceSha256': source['sha256'], 'sourceUrl': source['url'], 'page': number,
                'building': source['building'], 'floor': source['floor'], 'campus': 'Burnaby',
                'attribution': ATTRIBUTION, 'coordinateSystem': {'units': 'PDF points', 'origin': 'top-left',
                    'width': width, 'height': height, 'geographic': False, 'metersPerPoint': None,
                    'normalizedTransform': {'xDivisor': width, 'yDivisor': height}},
                'extraction': {'method': 'pdfplumber vector objects + existing text evidence',
                    'status': 'unreviewed', 'semanticClassification': 'unclassified',
                    'limitations': 'Lines/curves include annotations and symbols. No walls, doors, windows, room polygons, scale, accessibility or navigable edges have been verified.'},
                'primitives': primitives, 'longSegments': segments, 'labels': labels,
                'regions': [{'id': tile['id'], 'bounds': tile['bounds']} for tile in tile_records],
                'architecturalElements': [], 'routingEdges': [],
                'modelSummary': {'totalPrimitives': len(primitives), 'totalLongSegments': len(segments),
                    'sampledSegmentCount': len(model_segments), 'sampling': 'up to 8 longest per 4x4 grid cell; not complete topology',
                    'segments': model_segments, 'labels': labels[:80], 'omittedLabelCount': max(0,len(labels)-80)}}
            geometry_path = OUTPUT / 'geometry' / f'{plan_id}.json'
            write_json(geometry_path, geometry, compact=True)
            results.append({'id': plan_id, 'sourceId': source['id'], 'building': source['building'],
                'floor': source['floor'], 'page': number, 'width': width, 'height': height,
                'sourceUrl': source['url'], 'sourceSha256': source['sha256'], 'sourceRef': f"{source['id']}#page={number}",
                'attribution': ATTRIBUTION, 'full': full, 'overview': overview, 'tiles': tile_records,
                'geometry': {'file': str(geometry_path.relative_to(ROOT)), 'url': '/' + str(geometry_path.relative_to(ROOT)), 'sha256': digest(geometry_path)},
                'primitiveCount': len(primitives), 'longSegmentCount': len(segments), 'labelCount': len(labels)})
    return results


def font(size):
    for filename in ['/System/Library/Fonts/Helvetica.ttc', 'DejaVuSans.ttf']:
        try: return ImageFont.truetype(filename, size)
        except OSError: pass
    return ImageFont.load_default(size=size)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workers', type=int, default=3)
    args = parser.parse_args()
    manifest = json.loads((CAMPUS / 'manifest.json').read_text())
    sources = [s for s in manifest['sources'] if s['kind'] == 'floor-plan' and s['campus'] == 'Burnaby']
    if not sources: raise ValueError('No official Burnaby floor plans in the manifest')
    plans = []
    with ProcessPoolExecutor(max_workers=max(1,min(4,args.workers))) as pool:
        for index, result in enumerate(pool.map(process_source, sources), 1):
            plans.extend(result)
            if index % 10 == 0: print(f'Converted {index}/{len(sources)} floor plans', flush=True)
    # All plans are represented once in labeled overview sheets for visual shortlisting.
    atlases = []
    for offset in range(0, len(plans), 12):
        group = plans[offset:offset+12]
        canvas = Image.new('RGB',(1800,2200),'white')
        draw = ImageDraw.Draw(canvas)
        draw.text((24,16),'BCIT Burnaby · official floor-plan overview',fill='#173f31',font=font(24))
        draw.text((24,2164),ATTRIBUTION + ' · reference images; no navigation verification',fill='#435749',font=font(17))
        for slot, plan in enumerate(group):
            col, row = slot % 3, slot // 3
            x, y = col*600, 65+row*520
            image = Image.open(ROOT / plan['overview']['file']).convert('RGB')
            image.thumbnail((570,460),Image.Resampling.LANCZOS)
            canvas.paste(image,(x+(600-image.width)//2,y+(460-image.height)//2))
            draw.rectangle((x+8,y,x+592,y+506),outline='#b9c7b6',width=2)
            draw.text((x+18,y+473),plan['id'],font=font(22),fill='#173f31')
        atlas_id = f'atlas-{offset//12+1:02}'
        asset = image_record(OUTPUT / 'atlas' / f'{atlas_id}.png',canvas)
        atlases.append({'id': atlas_id, 'planIds': [p['id'] for p in group], **asset})
    write_json(OUTPUT / 'index.json', {'schemaVersion': 1, 'generatedAt': datetime.now(timezone.utc).isoformat(),
        'campus': 'Burnaby', 'attribution': ATTRIBUTION, 'sourceManifestSha256': digest(CAMPUS / 'manifest.json'),
        'status': 'Official source images; extracted geometry and AI location hypotheses require verification.',
        'plans': plans, 'atlases': atlases})
    print(f'Created {len(plans)} full PNGs, {len(plans)} overviews, {len(plans)*4} crops, {len(plans)} geometry JSONs, and {len(atlases)} overview sheets.',flush=True)


if __name__ == '__main__':
    main()
