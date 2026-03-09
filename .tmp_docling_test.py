from docling.document_converter import DocumentConverter
from pathlib import Path

p = Path(r"C:\Users\Keiru\Documents\programs\oltekocr-desktop\data\scans\2026-03-08T08-44-39-916Z_ATL0347N25 Contract.pdf")
print('exists', p.exists(), 'size', p.stat().st_size if p.exists() else None)
conv = DocumentConverter()

tests = [
    ('no_kwargs', {}),
    ('max_only', {'max_num_pages': 20}),
    ('range_only', {'page_range': (1, 20)}),
    ('both', {'max_num_pages': 20, 'page_range': (1, 20)}),
]

for label, kwargs in tests:
    try:
        conv.convert(str(p), **kwargs)
        print(label, 'OK')
    except Exception as e:
        print(label, 'ERR', type(e).__name__, str(e)[:300])
