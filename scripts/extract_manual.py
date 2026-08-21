import warnings, logging, sys, io
warnings.filterwarnings('ignore')
logging.disable(logging.CRITICAL)
stderr_backup = sys.stderr
sys.stderr = io.StringIO()
import pypdf
reader = pypdf.PdfReader(r'E:\File\文档\《北京化工大学本科生手册》（2023版）.pdf')
sys.stderr = stderr_backup

all_text = ''
for i in range(len(reader.pages)):
    try:
        t = reader.pages[i].extract_text()
        if t:
            all_text += t + '\n'
    except:
        pass

sys.stdout.buffer.write(all_text.encode('utf-8'))
