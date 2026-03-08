from pathlib import Path
from docling.document_converter import DocumentConverter
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import PdfFormatOption

p = Path(r"C:\Users\Keiru\Documents\programs\oltekocr-desktop\data\scans\2026-03-08T09-24-23-666Z_ATL0347N25 Contract.pdf")
print("File exists:", p.exists(), "size:", p.stat().st_size)

pipeline_opts = PdfPipelineOptions()
pipeline_opts.images_scale = 1.0
pipeline_opts.do_ocr = False

# Disable expensive stages
for attr in ["do_table_structure", "do_cell_matching", "do_formula_enrichment",
             "do_code_enrichment", "do_picture_classification", "do_picture_description"]:
    if hasattr(pipeline_opts, attr):
        setattr(pipeline_opts, attr, False)
        print(f"Disabled {attr}")

converter = DocumentConverter(
    format_options={
        InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_opts),
    },
)

# Test 1: max_num_pages=10 with raises_on_error=False 
print("\n--- Test 1: max_num_pages=10, raises_on_error=False ---")
try:
    result = converter.convert(str(p), max_num_pages=10, raises_on_error=False)
    print("Status:", result.status)
    print("Errors:", result.errors if hasattr(result, 'errors') else 'N/A')
    if hasattr(result, 'document') and result.document:
        items = list(result.document.iterate_items())
        print("Items found:", len(items))
    else:
        print("No document returned")
except Exception as e:
    print(f"EXCEPTION: {type(e).__name__}: {e}")
