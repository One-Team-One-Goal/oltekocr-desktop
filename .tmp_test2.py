from pathlib import Path
from docling.document_converter import DocumentConverter
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import PdfFormatOption

p = Path(r"C:\Users\Keiru\Documents\programs\oltekocr-desktop\data\scans\2026-03-08T09-24-23-666Z_ATL0347N25 Contract.pdf")

pipeline_opts = PdfPipelineOptions()
pipeline_opts.images_scale = 1.0
pipeline_opts.do_ocr = False
for attr in ["do_table_structure", "do_cell_matching", "do_formula_enrichment",
             "do_code_enrichment", "do_picture_classification", "do_picture_description"]:
    if hasattr(pipeline_opts, attr):
        setattr(pipeline_opts, attr, False)

converter = DocumentConverter(
    format_options={
        InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_opts),
    },
)

# Test: with Path object instead of str
print("--- Test: Path object with max_num_pages=10 ---")
try:
    result = converter.convert(p, max_num_pages=10, raises_on_error=False)
    print("Status:", result.status)
    if hasattr(result, 'document') and result.document:
        items = list(result.document.iterate_items())
        print("Items found:", len(items))
    else:
        print("No document")
except Exception as e:
    print(f"EXCEPTION: {type(e).__name__}: {e}")

# Test: page_range=(1, 10) only
print("\n--- Test: page_range=(1,10) ---")
try:
    result = converter.convert(p, page_range=(1, 10), raises_on_error=False)
    print("Status:", result.status)
    if hasattr(result, 'document') and result.document:
        items = list(result.document.iterate_items())
        print("Items found:", len(items))
    else:
        print("No document")
except Exception as e:
    print(f"EXCEPTION: {type(e).__name__}: {e}")

# Test: no limits at all, raises_on_error=False 
print("\n--- Test: no limits, raises_on_error=False ---")
try:
    result = converter.convert(p, raises_on_error=False)
    print("Status:", result.status)
    if hasattr(result, 'document') and result.document:
        items = list(result.document.iterate_items())
        print("Items found:", len(items))
    else:
        print("No document")
except Exception as e:
    print(f"EXCEPTION: {type(e).__name__}: {e}")
