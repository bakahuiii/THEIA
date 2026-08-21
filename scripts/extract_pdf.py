import warnings, logging
warnings.filterwarnings('ignore')
logging.disable(logging.CRITICAL)
import sys, io

stderr_backup = sys.stderr
sys.stderr = io.StringIO()

try:
    import pypdf
    reader = pypdf.PdfReader(r'E:\File\文档\《北京化工大学本科生学习指南》（2024版）.pdf')
    sys.stderr = stderr_backup
    text = ''
    for page in reader.pages:
        try:
            t = page.extract_text()
            if t:
                text += t + '\n'
        except Exception:
            pass
    sys.stdout.buffer.write(text.encode('utf-8'))
except Exception as e:
    sys.stderr = stderr_backup
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
